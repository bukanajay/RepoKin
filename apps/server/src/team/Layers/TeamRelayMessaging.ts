import type { EnvironmentId } from "@t3tools/contracts";
import type {
  MemberId,
  ReplicatedTeamEvent,
  TeamEvent,
  TeamInboxMessage,
  TeamRelayEnvelope,
  TeamRosterReadModel,
  TeamSignedDeliveryReceiptPayload,
  TeamSignedEventEnvelope,
  TeamSignedMessageEnvelope,
  TeamSignedMessagePayload,
} from "@t3tools/contracts/team";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { getOrCreateEnvironmentKeyPairFromSecretStore } from "../../cloud/environmentKeys.ts";
import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { makeTeamRelayClient, readTeamRelayConfig } from "../relayClient.ts";
import { collectRemoteEnvironments } from "../remoteEnvironments.ts";
import {
  signTeamDeliveryReceiptEnvelope,
  signTeamEventEnvelope,
  signTeamMessageEnvelope,
  verifyTeamDeliveryReceiptEnvelope,
  verifyTeamEventEnvelope,
  verifyTeamMessageEnvelope,
  verifyTeamWorkSignalEnvelope,
} from "../SignedMessaging.ts";
import { TeamEngineService } from "../Services/TeamEngine.ts";
import { TeamFileStore } from "../Services/TeamFileStore.ts";
import { TeamRelayPresence } from "../Services/TeamRelayPresence.ts";
import {
  TeamRelayMessaging,
  type TeamRelayMessagingShape,
} from "../Services/TeamRelayMessaging.ts";
import { TeamWorkSignals } from "../Services/TeamWorkSignals.ts";

const TEAM_RELAY_POLL_INTERVAL = "10 seconds";

/**
 * The domain events replicated across environments: channel posts, task events,
 * and (R2.3) delegation requests + their responses.
 */
const REPLICATED_EVENT_TYPES = new Set<TeamEvent["type"]>([
  "team.channel.posted",
  "team.task.created",
  "team.task.moved",
  "team.task.updated",
  "team.task.assigned",
  "team.task.commented",
  "team.task.reviewed",
  "team.request.created",
  "team.request.responded",
]);

function isReplicatedTeamEvent(event: TeamEvent): event is ReplicatedTeamEvent {
  return REPLICATED_EVENT_TYPES.has(event.type);
}

/** The member whose roster key signs a replicated event (its actor). */
function replicatedEventActorId(event: ReplicatedTeamEvent): MemberId {
  switch (event.type) {
    case "team.channel.posted":
      return event.authorId;
    case "team.task.created":
      return event.createdById;
    case "team.task.moved":
      return event.movedById;
    case "team.task.updated":
      return event.updatedById;
    case "team.task.assigned":
      return event.assignedById;
    case "team.task.commented":
      return event.authorId;
    case "team.task.reviewed":
      return event.reviewerId;
    case "team.request.created":
      return event.fromMemberId;
    case "team.request.responded":
      return event.responderId;
  }
}

/** When a replicated event occurred — R2 events carry `at`, requests do not. */
function replicatedEventOccurredAt(event: ReplicatedTeamEvent): string {
  switch (event.type) {
    case "team.request.created":
      return event.createdAt;
    case "team.request.responded":
      return event.respondedAt;
    default:
      return event.at;
  }
}

export { collectRemoteEnvironments };

function isSignedEventEnvelope(envelope: TeamRelayEnvelope): envelope is TeamSignedEventEnvelope {
  return "payload" in envelope && "event" in envelope.payload;
}

function isSignedWorkSignalEnvelope(
  envelope: TeamRelayEnvelope,
): envelope is import("@t3tools/contracts/team").TeamSignedWorkSignalEnvelope {
  return "payload" in envelope && "signals" in envelope.payload;
}

function isSignedMessageEnvelope(
  envelope: TeamRelayEnvelope,
): envelope is TeamSignedMessageEnvelope {
  return "payload" in envelope && "body" in envelope.payload;
}

export function matchesQueuedMessageForReceipt(input: {
  readonly message: TeamInboxMessage | undefined;
  readonly receipt: TeamSignedDeliveryReceiptPayload;
}): boolean {
  return (
    input.message !== undefined &&
    input.message.state === "queued" &&
    input.message.senderId === input.receipt.senderId &&
    input.message.recipientId === input.receipt.recipientId
  );
}

/**
 * An agent's home environment is unambiguous, so remote agent recipients route
 * there. A human also routes remotely when exactly one linked environment is
 * declared. Multiple remote human environments remain unresolved until human
 * app presence can select the current device without guessing.
 */
export function resolveRemoteRecipientEnvironment(input: {
  readonly roster: TeamRosterReadModel;
  readonly recipientId: MemberId;
  readonly localEnvironmentId: EnvironmentId;
  readonly activeHumanEnvironmentIds?: ReadonlyArray<EnvironmentId>;
}): EnvironmentId | null {
  const agent = input.roster.agents.find(
    (candidate) => String(candidate.id) === String(input.recipientId),
  );
  if (agent === undefined || agent.homeEnvironment === undefined) {
    const human = input.roster.humans.find(
      (candidate) => String(candidate.id) === String(input.recipientId),
    );
    if (human === undefined) {
      return null;
    }
    const environments = human.environments ?? [];
    const activeEnvironments = environments.filter((environment) =>
      (input.activeHumanEnvironmentIds ?? []).includes(environment.environmentId),
    );
    if (activeEnvironments.length === 1) {
      return activeEnvironments[0]!.environmentId === input.localEnvironmentId
        ? null
        : activeEnvironments[0]!.environmentId;
    }
    if (activeEnvironments.length > 1) {
      return null;
    }
    return environments.length === 1 && environments[0]!.environmentId !== input.localEnvironmentId
      ? environments[0]!.environmentId
      : null;
  }
  return agent.homeEnvironment !== input.localEnvironmentId ? agent.homeEnvironment : null;
}

const makeTeamRelayMessaging = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const serverEnvironment = yield* ServerEnvironment;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const teamEngine = yield* TeamEngineService;
  const teamFileStore = yield* TeamFileStore;
  const teamRelayPresence = yield* TeamRelayPresence;
  const teamWorkSignals = yield* TeamWorkSignals;
  const crypto = yield* Crypto.Crypto;
  const keyPair = yield* getOrCreateEnvironmentKeyPairFromSecretStore(secrets);
  const readRelayConfig = readTeamRelayConfig(secrets);
  const makeRelayClient = makeTeamRelayClient;
  const forwardedMessageIdsRef = yield* Ref.make(new Set<string>());
  const sentReceiptMessageIdsRef = yield* Ref.make(new Set<string>());
  const fannedOutEventKeysRef = yield* Ref.make(new Set<string>());

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
      const forwardedMessageIds = yield* Ref.get(forwardedMessageIdsRef);
      if (forwardedMessageIds.has(input.messageId)) {
        return;
      }
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
      const human = roster.humans.find(
        (candidate) => String(candidate.id) === String(message.recipientId),
      );
      const nowMs = (yield* DateTime.now).epochMilliseconds;
      const activeHumanEnvironmentIds =
        human === undefined
          ? []
          : yield* Effect.filter(
              (human.environments ?? []).map((environment) => environment.environmentId),
              (environmentId) =>
                teamRelayPresence
                  .resolveHumanEnvironmentPresence({ environmentId, nowMs })
                  .pipe(Effect.map((state) => state === "online")),
              { concurrency: "unbounded" },
            );
      const recipientEnvironmentId = resolveRemoteRecipientEnvironment({
        roster,
        recipientId: message.recipientId,
        localEnvironmentId,
        activeHumanEnvironmentIds,
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
      yield* Ref.update(forwardedMessageIdsRef, (current) => {
        const next = new Set(current);
        next.add(input.messageId);
        return next;
      });
      // Deliberately not marked "delivered" here: handing off to the relay
      // only means the recipient environment *can* pick it up, not that it
      // has. The message stays queued locally so a genuine non-delivery
      // (recipient never came online before the TTL) surfaces as a real
      // expiry rather than a false "delivered" (M3.4).
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

  const fanOutTeamEvent = (event: ReplicatedTeamEvent) =>
    Effect.gen(function* () {
      const relayConfig = yield* readRelayConfig.pipe(Effect.orElseSucceed(() => null));
      if (relayConfig === null) {
        return;
      }
      const projectId = event.aggregateId;
      const cwd = yield* resolveProjectCwd(projectId);
      if (cwd === null) {
        return;
      }
      const roster = yield* teamFileStore.readRoster(cwd);
      const localEnvironmentId = yield* serverEnvironment.getEnvironmentId;

      // Echo guard: a replicated event carries the *origin* environment in its
      // metadata (the re-dispatched command stamps it). Only fan out events
      // authored locally, so an inbound event is never re-broadcast.
      const originEnvironmentId = event.metadata.environmentId;
      if (
        originEnvironmentId !== undefined &&
        String(originEnvironmentId) !== String(localEnvironmentId)
      ) {
        return;
      }

      const remoteEnvironments = collectRemoteEnvironments({ roster, localEnvironmentId });
      if (remoteEnvironments.length === 0) {
        return;
      }
      const senderId = replicatedEventActorId(event);
      const relayClient = yield* makeRelayClient(relayConfig);

      // Bounded per-post fan-out: one signed envelope per remote roster
      // environment (channel member filtering is a visibility refinement — the
      // roster is the trust boundary). Each envelope is verified against the
      // author's roster key on arrival, exactly like a direct message.
      yield* Effect.forEach(
        remoteEnvironments,
        (recipientEnvironmentId) =>
          Effect.gen(function* () {
            const key = `${event.eventId}:${recipientEnvironmentId}`;
            if ((yield* Ref.get(fannedOutEventKeysRef)).has(key)) {
              return;
            }
            const now = yield* DateTime.now;
            const jti = yield* crypto.randomUUIDv4;
            const payload = {
              projectId,
              senderId,
              senderEnvironmentId: localEnvironmentId,
              recipientEnvironmentId,
              event,
              sentAt: replicatedEventOccurredAt(event),
            };
            const envelope = yield* signTeamEventEnvelope({
              privateKey: keyPair.privateKey,
              relayIssuer: relayConfig.issuer,
              payload,
              jti,
              now,
            });
            yield* relayClient.server.deliverTeamMessage({ payload: { envelope } });
            yield* Ref.update(fannedOutEventKeysRef, (current) => {
              const next = new Set(current);
              next.add(key);
              return next;
            });
          }),
        { discard: true, concurrency: "unbounded" },
      );
    }).pipe(
      Effect.ignoreCause({ log: true }),
      Effect.catch((error) =>
        Effect.logWarning("failed to fan out team event through relay", {
          eventType: event.type,
          eventId: event.eventId,
          error,
        }),
      ),
    );

  const queueDeliveryReceipt = (input: {
    readonly projectId: TeamSignedDeliveryReceiptPayload["projectId"];
    readonly messageId: TeamSignedDeliveryReceiptPayload["messageId"];
    readonly senderId: TeamSignedDeliveryReceiptPayload["senderId"];
    readonly senderEnvironmentId: TeamSignedDeliveryReceiptPayload["senderEnvironmentId"];
    readonly recipientId: TeamSignedDeliveryReceiptPayload["recipientId"];
    readonly recipientEnvironmentId: TeamSignedDeliveryReceiptPayload["recipientEnvironmentId"];
  }) =>
    Effect.gen(function* () {
      const receiptKey = `${input.projectId}:${input.messageId}`;
      if ((yield* Ref.get(sentReceiptMessageIdsRef)).has(receiptKey)) {
        return;
      }
      const relayConfig = yield* readRelayConfig.pipe(Effect.orElseSucceed(() => null));
      if (relayConfig === null) {
        return;
      }
      const now = yield* DateTime.now;
      const jti = yield* crypto.randomUUIDv4;
      const receipt = {
        ...input,
        deliveredAt: DateTime.formatIso(now),
      } satisfies TeamSignedDeliveryReceiptPayload;
      const envelope = yield* signTeamDeliveryReceiptEnvelope({
        privateKey: keyPair.privateKey,
        relayIssuer: relayConfig.issuer,
        receipt,
        jti,
        now,
      });
      const relayClient = yield* makeRelayClient(relayConfig);
      yield* relayClient.server.deliverTeamDeliveryReceipt({ payload: { envelope } });
      yield* Ref.update(sentReceiptMessageIdsRef, (current) => {
        const next = new Set(current);
        next.add(receiptKey);
        return next;
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("failed to queue team delivery receipt", {
          projectId: input.projectId,
          messageId: input.messageId,
          error,
        }),
      ),
    );

  const pollInbound: TeamRelayMessagingShape["pollInbound"] = () =>
    Effect.gen(function* () {
      const relayConfig = yield* readRelayConfig.pipe(Effect.orElseSucceed(() => null));
      if (relayConfig === null) {
        return;
      }
      const relayClient = yield* makeRelayClient(relayConfig);
      const response = yield* relayClient.server.pollTeamMessages();
      const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();
      const now = yield* DateTime.now;
      const nowEpochSeconds = Math.floor(now.epochMilliseconds / 1_000);
      const localEnvironmentId = yield* serverEnvironment.getEnvironmentId;

      yield* Effect.forEach(
        response.envelopes,
        (envelope) =>
          Effect.gen(function* () {
            const envelopeProjectId =
              "payload" in envelope ? envelope.payload.projectId : envelope.receipt.projectId;
            const project = snapshot.projects.find(
              (candidate) => candidate.id === envelopeProjectId,
            );
            if (project === undefined) {
              yield* Effect.logWarning("dropped inbound team envelope for unknown project", {
                projectId: envelopeProjectId,
              });
              return;
            }
            const roster = yield* teamFileStore.readRoster(project.workspaceRoot);
            if (isSignedEventEnvelope(envelope)) {
              const result = yield* verifyTeamEventEnvelope({
                envelope,
                roster,
                relayIssuer: relayConfig.issuer,
                nowEpochSeconds,
              });
              if (result._tag === "dropped") {
                yield* Effect.logWarning("dropped inbound team event", {
                  reason: result.reason,
                  detail: result.detail,
                });
                return;
              }
              // Re-dispatch as a command so the local decider re-validates
              // invariants and this environment's event log stays authoritative.
              // No delivery receipt: replicated events are broadcasts, not acks.
              yield* teamEngine.dispatch(result.command).pipe(
                Effect.catch((error) =>
                  Effect.logWarning("failed to dispatch inbound team event", {
                    commandType: result.command.type,
                    error,
                  }),
                ),
              );
              return;
            }
            if (isSignedWorkSignalEnvelope(envelope)) {
              const result = yield* verifyTeamWorkSignalEnvelope({
                envelope,
                roster,
                relayIssuer: relayConfig.issuer,
                nowEpochSeconds,
              });
              if (result._tag === "dropped") {
                yield* Effect.logWarning("dropped inbound work signal", {
                  reason: result.reason,
                  detail: result.detail,
                });
                return;
              }
              // Ephemeral cache only — never re-dispatched as domain events (R3.1).
              yield* teamWorkSignals.ingestRemoteSignals(result.signals);
              return;
            }
            if (isSignedMessageEnvelope(envelope)) {
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
              const dispatched = yield* teamEngine.dispatch(result.command).pipe(
                Effect.as(true),
                Effect.catch((error) =>
                  Effect.logWarning("failed to dispatch inbound team message", {
                    messageId: result.command.messageId,
                    error,
                  }).pipe(Effect.as(false)),
                ),
              );
              if (!dispatched) {
                return;
              }

              yield* queueDeliveryReceipt({
                projectId: envelope.payload.projectId,
                messageId: envelope.payload.messageId,
                senderId: envelope.payload.senderId,
                senderEnvironmentId: envelope.payload.senderEnvironmentId,
                recipientId: envelope.payload.recipientId,
                recipientEnvironmentId: localEnvironmentId,
              });
              return;
            }

            if (envelope.receipt.senderEnvironmentId !== localEnvironmentId) {
              yield* Effect.logWarning("dropped team delivery receipt for another environment", {
                messageId: envelope.receipt.messageId,
                expectedEnvironmentId: localEnvironmentId,
                receivedEnvironmentId: envelope.receipt.senderEnvironmentId,
              });
              return;
            }
            const result = yield* verifyTeamDeliveryReceiptEnvelope({
              envelope,
              roster,
              relayIssuer: relayConfig.issuer,
              nowEpochSeconds,
            });
            if (result._tag === "dropped") {
              yield* Effect.logWarning("dropped inbound team delivery receipt", {
                reason: result.reason,
                detail: result.detail,
              });
              return;
            }

            const readModel = yield* teamEngine.getReadModel;
            const localProject = readModel.projects.find(
              (candidate) => candidate.projectId === envelope.receipt.projectId,
            );
            const queuedMessage = localProject?.inbox.find(
              (candidate) => candidate.messageId === envelope.receipt.messageId,
            );
            if (
              !matchesQueuedMessageForReceipt({ message: queuedMessage, receipt: envelope.receipt })
            ) {
              yield* Effect.logWarning(
                "dropped delivery receipt without a matching queued message",
                {
                  messageId: envelope.receipt.messageId,
                },
              );
              return;
            }
            yield* teamEngine.dispatch(result.command).pipe(
              Effect.catch((error) =>
                Effect.logWarning("failed to apply inbound team delivery receipt", {
                  messageId: result.command.messageId,
                  error,
                }),
              ),
            );
          }),
        { discard: true, concurrency: "unbounded" },
      );

      const readModel = yield* teamEngine.getReadModel;
      yield* Effect.forEach(
        readModel.projects,
        (project) =>
          Effect.forEach(
            project.inbox.filter(
              (message) =>
                message.senderEnvironmentId !== null &&
                message.senderEnvironmentId !== localEnvironmentId &&
                message.state !== "expired",
            ),
            (message) =>
              queueDeliveryReceipt({
                projectId: project.projectId,
                messageId: message.messageId,
                senderId: message.senderId,
                senderEnvironmentId: message.senderEnvironmentId!,
                recipientId: message.recipientId,
                recipientEnvironmentId: localEnvironmentId,
              }),
            { discard: true, concurrency: "unbounded" },
          ),
        { discard: true, concurrency: "unbounded" },
      );
      yield* Effect.forEach(
        readModel.projects,
        (project) =>
          Effect.forEach(
            project.inbox.filter((message) => message.state === "queued"),
            (message) =>
              forwardQueuedMessage({
                projectId: project.projectId,
                messageId: message.messageId,
              }),
            { discard: true, concurrency: "unbounded" },
          ),
        { discard: true, concurrency: "unbounded" },
      );
    }).pipe(Effect.catch((error) => Effect.logWarning("team message poll failed", { error })));

  yield* teamEngine.streamDomainEvents.pipe(
    Stream.runForEach((event) => {
      if (event.type === "team.message.queued") {
        return forwardQueuedMessage({ projectId: event.aggregateId, messageId: event.messageId });
      }
      if (isReplicatedTeamEvent(event)) {
        return fanOutTeamEvent(event);
      }
      return Effect.void;
    }),
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
