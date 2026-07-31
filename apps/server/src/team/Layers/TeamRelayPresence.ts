import type { EnvironmentId } from "@t3tools/contracts";
import type { RelayAgentAwarenessPhase } from "@t3tools/contracts/relay";
import { resolveMemberPresenceState } from "@t3tools/shared/agentAwareness";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { makeTeamRelayClient, readTeamRelayConfig } from "../relayClient.ts";
import { TeamFileStore } from "../Services/TeamFileStore.ts";
import { TeamRelayPresence, type TeamRelayPresenceShape } from "../Services/TeamRelayPresence.ts";

const TEAM_RELAY_PRESENCE_POLL_INTERVAL = "10 seconds";
const TEAM_RELAY_PRESENCE_MAX_ENVIRONMENTS = 200;

interface CachedEnvironmentPresence {
  readonly phase: RelayAgentAwarenessPhase;
  readonly updatedAt: string;
}

/**
 * Every roster agent's home environment across currently-open projects that
 * isn't this environment — the set worth asking the relay about. Capped so a
 * huge roster can never send an oversized presence request.
 */
export function resolveRemoteHomeEnvironmentIds(input: {
  readonly rosters: ReadonlyArray<{
    readonly agents: ReadonlyArray<{ readonly homeEnvironment?: EnvironmentId | undefined }>;
  }>;
  readonly localEnvironmentId: EnvironmentId;
}): ReadonlyArray<EnvironmentId> {
  const remote = new Set<EnvironmentId>();
  for (const roster of input.rosters) {
    for (const agent of roster.agents) {
      if (
        agent.homeEnvironment !== undefined &&
        agent.homeEnvironment !== input.localEnvironmentId
      ) {
        remote.add(agent.homeEnvironment);
      }
    }
  }
  return [...remote].slice(0, TEAM_RELAY_PRESENCE_MAX_ENVIRONMENTS);
}

const makeTeamRelayPresence = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const serverEnvironment = yield* ServerEnvironment;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const teamFileStore = yield* TeamFileStore;
  const cacheRef = yield* Ref.make(new Map<EnvironmentId, CachedEnvironmentPresence>());

  const pollOnce = Effect.gen(function* () {
    const relayConfig = yield* readTeamRelayConfig(secrets).pipe(Effect.orElseSucceed(() => null));
    if (relayConfig === null) {
      return;
    }
    const localEnvironmentId = yield* serverEnvironment.getEnvironmentId;
    const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();
    const rosters = yield* Effect.forEach(
      snapshot.projects,
      (project) => teamFileStore.readRoster(project.workspaceRoot),
      { concurrency: "unbounded" },
    );
    const environmentIds = resolveRemoteHomeEnvironmentIds({ rosters, localEnvironmentId });
    if (environmentIds.length === 0) {
      yield* Ref.set(cacheRef, new Map());
      return;
    }

    const relayClient = yield* makeTeamRelayClient(relayConfig);
    const response = yield* relayClient.server.getEnvironmentPresence({
      payload: { environmentIds },
    });
    const nextCache = new Map<EnvironmentId, CachedEnvironmentPresence>();
    for (const presence of response.presences) {
      nextCache.set(presence.environmentId, {
        phase: presence.phase,
        updatedAt: presence.updatedAt,
      });
    }
    yield* Ref.set(cacheRef, nextCache);
  }).pipe(Effect.catch((error) => Effect.logWarning("team presence poll failed", { error })));

  yield* pollOnce.pipe(
    Effect.andThen(Effect.sleep(TEAM_RELAY_PRESENCE_POLL_INTERVAL)),
    Effect.forever,
    Effect.forkScoped,
  );

  const resolveRemoteEnvironmentPresence: TeamRelayPresenceShape["resolveRemoteEnvironmentPresence"] =
    (input) =>
      Ref.get(cacheRef).pipe(
        Effect.map((cache) => {
          const cached = cache.get(input.environmentId);
          if (cached === undefined) {
            return null;
          }
          return resolveMemberPresenceState({
            phase: cached.phase,
            updatedAt: cached.updatedAt,
            nowMs: input.nowMs,
          });
        }),
      );

  return {
    resolveRemoteEnvironmentPresence,
  } satisfies TeamRelayPresenceShape;
});

export const TeamRelayPresenceLive = Layer.effect(TeamRelayPresence, makeTeamRelayPresence);
