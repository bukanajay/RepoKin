import type { EnvironmentId } from "@t3tools/contracts";
import type { RelayAgentAwarenessPhase } from "@t3tools/contracts/relay";
import {
  TEAM_PRESENCE_STALENESS_MS,
  resolveMemberPresenceState,
} from "@t3tools/shared/agentAwareness";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
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

export function resolveHumanEnvironmentPresenceState(input: {
  readonly activeAt: string | null;
  readonly nowMs: number;
}): "online" | "offline" | null {
  if (input.activeAt === null) {
    return null;
  }
  const activeAtMs = Date.parse(input.activeAt);
  return Number.isFinite(activeAtMs) && input.nowMs - activeAtMs <= TEAM_PRESENCE_STALENESS_MS
    ? "online"
    : "offline";
}

/**
 * Every roster agent's home environment across currently-open projects that
 * isn't this environment — the set worth asking the relay about. Capped so a
 * huge roster can never send an oversized presence request.
 */
export function resolveRemoteHomeEnvironmentIds(input: {
  readonly rosters: ReadonlyArray<{
    readonly agents: ReadonlyArray<{ readonly homeEnvironment?: EnvironmentId | undefined }>;
    readonly humans: ReadonlyArray<{
      readonly environments?: ReadonlyArray<{ readonly environmentId: EnvironmentId }> | undefined;
    }>;
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
    for (const human of roster.humans) {
      for (const environment of human.environments ?? []) {
        if (environment.environmentId !== input.localEnvironmentId) {
          remote.add(environment.environmentId);
        }
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
  const readRelayConfig = readTeamRelayConfig(secrets);
  const cacheRef = yield* Ref.make(new Map<EnvironmentId, CachedEnvironmentPresence>());
  const humanCacheRef = yield* Ref.make(new Map<EnvironmentId, string>());
  const localHumanActiveAtRef = yield* Ref.make<string | null>(null);

  const pollOnce = Effect.gen(function* () {
    const relayConfig = yield* readRelayConfig.pipe(Effect.orElseSucceed(() => null));
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
      yield* Ref.set(humanCacheRef, new Map());
      return;
    }

    const relayClient = yield* makeTeamRelayClient(relayConfig);
    const [response, humanResponse] = yield* Effect.all([
      relayClient.server.getEnvironmentPresence({ payload: { environmentIds } }),
      relayClient.server.getTeamHumanPresence({ payload: { environmentIds } }),
    ]);
    const nextCache = new Map<EnvironmentId, CachedEnvironmentPresence>();
    for (const presence of response.presences) {
      nextCache.set(presence.environmentId, {
        phase: presence.phase,
        updatedAt: presence.updatedAt,
      });
    }
    yield* Ref.set(cacheRef, nextCache);
    yield* Ref.set(
      humanCacheRef,
      new Map(
        humanResponse.presences.map((presence) => [presence.environmentId, presence.activeAt]),
      ),
    );
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

  const publishLocalHumanPresence = Effect.gen(function* () {
    const now = yield* DateTime.now;
    yield* Ref.set(localHumanActiveAtRef, DateTime.formatIso(now));
    const relayConfig = yield* readRelayConfig.pipe(Effect.orElseSucceed(() => null));
    if (relayConfig === null) {
      return;
    }
    const relayClient = yield* makeTeamRelayClient(relayConfig);
    yield* relayClient.server.heartbeatTeamHumanPresence({ payload: {} });
  }).pipe(Effect.catch((error) => Effect.logWarning("human presence heartbeat failed", { error })));

  const resolveHumanEnvironmentPresence: TeamRelayPresenceShape["resolveHumanEnvironmentPresence"] =
    (input) =>
      Effect.gen(function* () {
        const localEnvironmentId = yield* serverEnvironment.getEnvironmentId;
        const activeAt =
          input.environmentId === localEnvironmentId
            ? yield* Ref.get(localHumanActiveAtRef)
            : ((yield* Ref.get(humanCacheRef)).get(input.environmentId) ?? null);
        return resolveHumanEnvironmentPresenceState({ activeAt, nowMs: input.nowMs });
      });

  return {
    resolveRemoteEnvironmentPresence,
    publishLocalHumanPresence,
    resolveHumanEnvironmentPresence,
  } satisfies TeamRelayPresenceShape;
});

export const TeamRelayPresenceLive = Layer.effect(TeamRelayPresence, makeTeamRelayPresence);
