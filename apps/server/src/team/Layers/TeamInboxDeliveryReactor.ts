import { CommandId } from "@t3tools/contracts";
import type { TeamInboxMessage, TeamProjectReadModel } from "@t3tools/contracts/team";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { TeamEngineService } from "../Services/TeamEngine.ts";
import { TeamFileStore } from "../Services/TeamFileStore.ts";
import {
  TeamInboxDeliveryReactor,
  type TeamInboxDeliveryReactorShape,
} from "../Services/TeamInboxDeliveryReactor.ts";
import { TeamPresenceResolver } from "../Services/TeamPresenceResolver.ts";

export type QueuedTeamMessageDeliveryDecision = "deliver" | "expire" | "wait";

export function resolveQueuedTeamMessageDelivery(input: {
  readonly message: Pick<TeamInboxMessage, "expiresAt">;
  readonly recipientPresence: "online" | "busy" | "away" | "offline" | null;
  readonly nowMs: number;
}): QueuedTeamMessageDeliveryDecision {
  if (input.message.expiresAt !== null && Date.parse(input.message.expiresAt) <= input.nowMs) {
    return "expire";
  }
  return input.recipientPresence === "online" ? "deliver" : "wait";
}

function isAgentMember(memberId: string): boolean {
  return memberId.startsWith("agent_") || memberId.startsWith("agent-");
}

/**
 * The local inbox can only *deliver* a message to an agent actually running
 * in this environment. A roster agent whose home environment is elsewhere
 * has no local presence to trust for that decision even though M3.3 lets
 * TeamPresenceResolver report one (via the relay) — this reactor must still
 * only ever "wait" or "expire" such a message; TeamRelayMessaging is the only
 * path that forwards it to where it can actually be acted on.
 */
export function resolveIsRemoteHomeAgent(input: {
  readonly recipientId: string;
  readonly roster: {
    readonly agents: ReadonlyArray<{
      readonly id: string;
      readonly homeEnvironment?: string | undefined;
    }>;
  };
  readonly localEnvironmentId: string;
}): boolean {
  if (!isAgentMember(input.recipientId)) {
    return false;
  }
  const agent = input.roster.agents.find((candidate) => candidate.id === input.recipientId);
  return (
    agent !== undefined &&
    agent.homeEnvironment !== undefined &&
    agent.homeEnvironment !== input.localEnvironmentId
  );
}

function shouldRetryInboxDeliveryForOrchestrationEvent(eventType: string): boolean {
  switch (eventType) {
    case "thread.session-set":
    case "thread.turn-start-requested":
    case "thread.turn-started":
    case "thread.turn-completed":
    case "thread.activity-appended":
      return true;
    default:
      return false;
  }
}

const makeTeamInboxDeliveryReactor = Effect.gen(function* () {
  const teamEngine = yield* TeamEngineService;
  const presenceResolver = yield* TeamPresenceResolver;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const teamFileStore = yield* TeamFileStore;
  const serverEnvironment = yield* ServerEnvironment;
  const crypto = yield* Crypto.Crypto;

  const serverCommandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => CommandId.make(`server:team-${tag}:${uuid}`)));

  const dispatchDeliveryDecision = (
    project: TeamProjectReadModel,
    message: TeamInboxMessage,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      const member = project.members.find(
        (candidate) => candidate.memberId === message.recipientId,
      );
      const recipientPresence =
        member?.memberType === "human" || !isAgentMember(message.recipientId)
          ? "online"
          : yield* presenceResolver.resolveMemberPresence({
              projectId: project.projectId,
              memberId: message.recipientId,
              nowMs,
            });
      const localEnvironmentId = yield* serverEnvironment.getEnvironmentId;
      const shellSnapshot = yield* projectionSnapshotQuery.getShellSnapshot();
      const workspaceRoot = shellSnapshot.projects.find(
        (candidate) => candidate.id === project.projectId,
      )?.workspaceRoot;
      const roster =
        workspaceRoot === undefined ? null : yield* teamFileStore.readRoster(workspaceRoot);
      const isRemoteHomeAgent =
        roster !== null &&
        resolveIsRemoteHomeAgent({
          recipientId: message.recipientId,
          roster,
          localEnvironmentId,
        });
      const decision = resolveQueuedTeamMessageDelivery({
        message,
        recipientPresence: isRemoteHomeAgent ? "offline" : recipientPresence,
        nowMs,
      });

      if (decision === "wait") {
        return;
      }

      const commandId = yield* serverCommandId(decision === "deliver" ? "deliver" : "expire");
      yield* teamEngine.dispatch(
        decision === "deliver"
          ? {
              type: "team.message.deliver",
              commandId,
              projectId: project.projectId,
              messageId: message.messageId,
              metadata: { actorMemberId: message.recipientId },
            }
          : {
              type: "team.message.expire",
              commandId,
              projectId: project.projectId,
              messageId: message.messageId,
              metadata: { actorMemberId: message.recipientId },
            },
      );
    }).pipe(Effect.ignoreCause({ log: true }));

  const processProject = (projectId: TeamProjectReadModel["projectId"]): Effect.Effect<void> =>
    Effect.gen(function* () {
      const readModel = yield* teamEngine.getReadModel;
      const project = readModel.projects.find((candidate) => candidate.projectId === projectId);
      if (project === undefined) {
        return;
      }
      yield* Effect.forEach(
        project.inbox.filter((message) => message.state === "queued"),
        (message) => dispatchDeliveryDecision(project, message),
        { discard: true },
      );
    });

  const worker = yield* makeDrainableWorker(processProject);

  yield* teamEngine.streamDomainEvents.pipe(
    Stream.runForEach((event) =>
      event.type === "team.message.queued" ? worker.enqueue(event.aggregateId) : Effect.void,
    ),
    Effect.forkScoped,
  );

  yield* orchestrationEngine.streamDomainEvents.pipe(
    Stream.runForEach((event) =>
      shouldRetryInboxDeliveryForOrchestrationEvent(event.type)
        ? teamEngine.getReadModel.pipe(
            Effect.flatMap((readModel) =>
              Effect.forEach(
                readModel.projects.map((project) => project.projectId),
                worker.enqueue,
                { discard: true },
              ),
            ),
          )
        : Effect.void,
    ),
    Effect.forkScoped,
  );

  return {
    enqueueProject: worker.enqueue,
    drain: worker.drain,
  } satisfies TeamInboxDeliveryReactorShape;
});

export const TeamInboxDeliveryReactorLive = Layer.effect(
  TeamInboxDeliveryReactor,
  makeTeamInboxDeliveryReactor,
);
