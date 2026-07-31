import { projectAgentThreadPresence, projectThreadAwareness } from "@t3tools/shared/agentAwareness";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import {
  TeamPresenceResolver,
  type TeamPresenceResolverShape,
} from "../Services/TeamPresenceResolver.ts";

const makeTeamPresenceResolver = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const serverEnvironment = yield* ServerEnvironment;

  const resolveMemberPresence: TeamPresenceResolverShape["resolveMemberPresence"] = (input) =>
    Effect.gen(function* () {
      const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();
      const project = snapshot.projects.find((candidate) => candidate.id === input.projectId);
      if (project === undefined) {
        return null;
      }
      const environmentId = yield* serverEnvironment.getEnvironmentId;
      const presences = snapshot.threads.flatMap((thread) => {
        if (thread.projectId !== input.projectId || thread.agentforgeAgentId !== input.memberId) {
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
      return (
        presences.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
          ?.state ?? null
      );
    });

  return {
    resolveMemberPresence,
  } satisfies TeamPresenceResolverShape;
});

export const TeamPresenceResolverLive = Layer.effect(
  TeamPresenceResolver,
  makeTeamPresenceResolver,
);
