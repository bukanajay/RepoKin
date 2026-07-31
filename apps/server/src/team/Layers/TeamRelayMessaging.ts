import { CommandId, type EnvironmentId } from "@t3tools/contracts";
import type {
  MemberId,
  TeamRosterReadModel,
  TeamSignedMessagePayload,
} from "@t3tools/contracts/team";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { getOrCreateEnvironmentKeyPairFromSecretStore } from "../../cloud/environmentKeys.ts";
import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { makeTeamRelayClient, readTeamRelayConfig } from "../relayClient.ts";
import { signTeamMessageEnvelope, verifyTeamMessageEnvelope } from "../SignedMessaging.ts";
import { TeamEngineService } from "../Services/TeamEngine.ts";
import { TeamFileStore } from "../Services/TeamFileStore.ts";
import {
  TeamRelayMessaging,
  type TeamRelayMessagingShape,
} from "../Services/TeamRelayMessaging.ts";

const TEAM_RELAY_POLL_INTERVAL = "10 seconds";

/**
 * An agent's home environment is unambiguous, so remote agent recipients
 * route there. A human can have several linked environments and this
 * environment has no cross-machine presence yet (M3.3), so human recipients
 * stay local for now rather than guessing which of their environments is
 * current.
 */
export function resolveRemoteRecipientEnvironment(input: {
  readonly roster: TeamRosterReadModel;
  readonly recipientId: MemberId;
  readonly localEnvironmentId: EnvironmentId;
}): EnvironmentId | null {
  const agent = input.roster.agents.find(
    (candidate) => String(candidate.id) === String(input.recipientId),
  );
  if (agent === undefined || agent.homeEnvironment === undefined) {
    return null;
  }
  return agent.homeEnvironment !== input.localEnvironmentId ? agent.homeEnvironment : null;
}

const makeTeamRelayMessaging = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const serverEnvironment = yield* ServerEnvironment;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const teamEngine = yield* TeamEngineService;
  const teamFileStore = yield* TeamFileStore;
  const crypto = yield* Crypto.Crypto;
  const keyPair = yield* getOrCreateEnvironmentKeyPairFromSecretStore(secrets);
  const readRelayConfig = readTeamRelayConfig(secrets);
  const makeRelayClient = makeTeamRelayClient;

  const resolveProjectCwd = (projectId: string) =>
    projectionSnapshotQuery
      .getShellSnapshot()
      .pipe(
        Effect.map(
          (snapshot) =>
            snapshot.projects.find((project) => project.id === projectId)?.workspaceRoot ?? null,
        ),
      );

  const forwardQueuedMessage: TeamRelayMessagingShape["forwardQueuedMessage"] = (input) =>
    Effect.gen(function* () {
      const relayConfig = yield* readRelayConfig.pipe(Effect.orElseSucceed(() => null));
      if (relayConfig === null) {
        return;
      }
      const cwd = yield* resolveProjectCwd(input.projectId);
      if (cwd === null) {
        return;
      }
      const readModel = yield* teamEngine.getReadModel;
      const project = readModel.projects.find(
        (candidate) => candidate.projectId === input.projectId,
      );
      const message = project?.inbox.find((candidate) => candidate.messageId === input.messageId);
      if (message === undefined || message.state !== "queued") {
        return;
      }
      const roster = yield* teamFileStore.readRoster(cwd);
      const localEnvironmentId = yield* serverEnvironment.getEnvironmentId;
      const recipientEnvironmentId = resolveRemoteRecipientEnvironment({
        roster,
        recipientId: message.recipientId,
        localEnvironmentId,
      });
      if (recipientEnvironmentId === null) {
        return;
      }

      const now = yield* DateTime.now;
      const jti = yield* crypto.randomUUIDv4;
      const payload = {
        projectId: input.projectId,
        messageId: message.messageId,
        senderId: message.senderId,
        senderEnvironmentId: localEnvironmentId,
        recipientId: message.recipientId,
        recipientEnvironmentId,
        body: message.body,
        ...(message.threadId === null ? {} : { threadId: message.threadId }),
        sentAt: message.sentAt,
        ...(message.expiresAt === null ? {} : { expiresAt: message.expiresAt }),
      } satisfies TeamSignedMessagePayload;
      const envelope = yield* signTeamMessageEnvelope({
        privateKey: keyPair.privateKey,
        relayIssuer: relayConfig.issuer,
        payload,
        jti,
        now,
      });

      const relayClient = yield* makeRelayClient(relayConfig);
      yield* relayClient.server.deliverTeamMessage({ payload: { envelope } });

      const deliverCommandId = yield* crypto.randomUUIDv4.pipe(
        Effect.map((uuid) => CommandId.make(`server:team-relay-deliver:${uuid}`)),
      );
      yield* teamEngine.dispatch({
        type: "team.message.deliver",
        commandId: deliverCommandId,
        projectId: input.projectId,
        messageId: message.messageId,
        metadata: { actorMemberId: message.recipientId },
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("failed to forward queued team message through relay", {
          projectId: input.projectId,
          messageId: input.messageId,
          error,
        }),
      ),
      Effect.ignoreCause({ log: true }),
    );

  const pollInbound: TeamRelayMessagingShape["pollInbound"] = () =>
    Effect.gen(function* () {
      const relayConfig = yield* readRelayConfig.pipe(Effect.orElseSucceed(() => null));
      if (relayConfig === null) {
        return;
      }
      const relayClient = yield* makeRelayClient(relayConfig);
      const response = yield* relayClient.server.pollTeamMessages();
      if (response.envelopes.length === 0) {
        return;
      }
      const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();
      const now = yield* DateTime.now;
      const nowEpochSeconds = Math.floor(now.epochMilliseconds / 1_000);

      yield* Effect.forEach(
        response.envelopes,
        (envelope) =>
          Effect.gen(function* () {
            const project = snapshot.projects.find(
              (candidate) => candidate.id === envelope.payload.projectId,
            );
            if (project === undefined) {
              yield* Effect.logWarning("dropped inbound team message for unknown project", {
                projectId: envelope.payload.projectId,
              });
              return;
            }
            const roster = yield* teamFileStore.readRoster(project.workspaceRoot);
            const result = yield* verifyTeamMessageEnvelope({
              envelope,
              roster,
              relayIssuer: relayConfig.issuer,
              nowEpochSeconds,
            });
            if (result._tag === "dropped") {
              yield* Effect.logWarning("dropped inbound team message", {
                reason: result.reason,
                detail: result.detail,
              });
              return;
            }
            yield* teamEngine.dispatch(result.command).pipe(
              Effect.catch((error) =>
                Effect.logWarning("failed to dispatch inbound team message", {
                  messageId: result.command.messageId,
                  error,
                }),
              ),
            );
          }),
        { discard: true, concurrency: "unbounded" },
      );
    }).pipe(Effect.catch((error) => Effect.logWarning("team message poll failed", { error })));

  yield* teamEngine.streamDomainEvents.pipe(
    Stream.runForEach((event) =>
      event.type === "team.message.queued"
        ? forwardQueuedMessage({ projectId: event.aggregateId, messageId: event.messageId })
        : Effect.void,
    ),
    Effect.forkScoped,
  );

  yield* pollInbound().pipe(
    Effect.andThen(Effect.sleep(TEAM_RELAY_POLL_INTERVAL)),
    Effect.forever,
    Effect.forkScoped,
  );

  return {
    forwardQueuedMessage,
    pollInbound,
  } satisfies TeamRelayMessagingShape;
});

export const TeamRelayMessagingLive = Layer.effect(TeamRelayMessaging, makeTeamRelayMessaging);
