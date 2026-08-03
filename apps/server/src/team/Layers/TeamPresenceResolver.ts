import type { EnvironmentId } from "@t3tools/contracts";
import type { MemberId } from "@t3tools/contracts/team";
import { projectAgentThreadPresence, projectThreadAwareness } from "@t3tools/shared/agentAwareness";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { TeamFileStore } from "../Services/TeamFileStore.ts";
import {
  TeamPresenceResolver,
  type TeamPresenceResolverShape,
} from "../Services/TeamPresenceResolver.ts";
import { TeamRelayPresence } from "../Services/TeamRelayPresence.ts";

const makeTeamPresenceResolver = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const serverEnvironment = yield* ServerEnvironment;
  const teamFileStore = yield* TeamFileStore;
  const teamRelayPresence = yield* TeamRelayPresence;

  const resolveRemoteAgentPresence = (input: {
    readonly workspaceRoot: string;
    readonly memberId: MemberId;
    readonly localEnvironmentId: EnvironmentId;
    readonly nowMs: number;
  }) =>
    Effect.gen(function* () {
      const roster = yield* teamFileStore.readRoster(input.workspaceRoot);
      const agent = roster.agents.find(
        (candidate) => String(candidate.id) === String(input.memberId),
      );
      if (
        agent === undefined ||
        agent.homeEnvironment === undefined ||
        agent.homeEnvironment === input.localEnvironmentId
      ) {
        return null;
      }
      return yield* teamRelayPresence.resolveRemoteEnvironmentPresence({
        environmentId: agent.homeEnvironment,
        nowMs: input.nowMs,
      });
    });

  const resolveMemberPresence: TeamPresenceResolverShape["resolveMemberPresence"] = (input) =>
    Effect.gen(function* () {
      const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();
      const project = snapshot.projects.find((candidate) => candidate.id === input.projectId);
      if (project === undefined) {
        return null;
      }
      const environmentId = yield* serverEnvironment.getEnvironmentId;
      const presences = snapshot.threads.flatMap((thread) => {
        if (thread.projectId !== input.projectId || thread.repokinAgentId !== input.memberId) {
          return [];
        }
        const awareness = projectThreadAwareness({
          environmentId,
          project,
          thread,
        });
        if (awareness === null) {
          return [];
        }
        return [
          projectAgentThreadPresence({
            memberId: input.memberId,
            awareness,
            nowMs: input.nowMs,
          }),
        ];
      });
      const localPresence =
        presences.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
          ?.state ?? null;
      if (localPresence !== null) {
        return localPresence;
      }
      const roster = yield* teamFileStore.readRoster(project.workspaceRoot);
      const human = roster.humans.find(
        (candidate) => String(candidate.id) === String(input.memberId),
      );
      if (human !== undefined) {
        const states = yield* Effect.forEach(
          human.environments ?? [],
          (environment) =>
            teamRelayPresence.resolveHumanEnvironmentPresence({
              environmentId: environment.environmentId,
              nowMs: input.nowMs,
            }),
          { concurrency: "unbounded" },
        );
        if (states.includes("online")) {
          return "online";
        }
        return states.includes("offline") ? "offline" : null;
      }
      // No local thread activity for this member — it may be a roster agent
      // whose home environment is a different machine (M3.3).
      return yield* resolveRemoteAgentPresence({
        workspaceRoot: project.workspaceRoot,
        memberId: input.memberId,
        localEnvironmentId: environmentId,
        nowMs: input.nowMs,
      });
    });

  return {
    publishHumanPresence: teamRelayPresence.publishLocalHumanPresence,
    resolveMemberPresence,
  } satisfies TeamPresenceResolverShape;
});

export const TeamPresenceResolverLive = Layer.effect(
  TeamPresenceResolver,
  makeTeamPresenceResolver,
);
