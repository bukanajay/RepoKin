import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { OrchestrationShellSnapshot } from "@t3tools/contracts";
import { AgentId, MemberId, type TeamRosterReadModel } from "@t3tools/contracts/team";
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { TeamFileStore } from "../Services/TeamFileStore.ts";
import { TeamPresenceResolver } from "../Services/TeamPresenceResolver.ts";
import { TeamRelayPresence } from "../Services/TeamRelayPresence.ts";
import { TeamPresenceResolverLive } from "./TeamPresenceResolver.ts";

const projectId = ProjectId.make("project-1");
const localEnvironmentId = EnvironmentId.make("env-local");
const remoteEnvironmentId = EnvironmentId.make("env-remote");
const localAgentId = MemberId.make(AgentId.make("agent_local"));
const remoteAgentId = MemberId.make(AgentId.make("agent_remote"));

const snapshot = {
  projects: [{ id: projectId, workspaceRoot: "/tmp/project-1" }],
  threads: [],
} as unknown as OrchestrationShellSnapshot;

const roster: TeamRosterReadModel = {
  humans: [],
  agents: [
    {
      schemaVersion: 1,
      id: AgentId.make("agent_local"),
      type: "agent",
      name: "Local",
      owner: undefined as never,
      homeEnvironment: localEnvironmentId,
      character: { characterVersion: 1, persona: "Local agent" },
    },
    {
      schemaVersion: 1,
      id: AgentId.make("agent_remote"),
      type: "agent",
      name: "Remote",
      owner: undefined as never,
      homeEnvironment: remoteEnvironmentId,
      character: { characterVersion: 1, persona: "Remote agent" },
    },
  ],
  warnings: [],
};

const testLayer = (remotePresenceState: "online" | "busy" | "away" | "offline" | null) =>
  Layer.mergeAll(
    Layer.succeed(ProjectionSnapshotQuery, {
      getShellSnapshot: () => Effect.succeed(snapshot),
    } as unknown as ProjectionSnapshotQuery["Service"]),
    Layer.succeed(ServerEnvironment, {
      getEnvironmentId: Effect.succeed(localEnvironmentId),
    } as unknown as ServerEnvironment["Service"]),
    Layer.succeed(TeamFileStore, {
      readRoster: () => Effect.succeed(roster),
    } as unknown as TeamFileStore["Service"]),
    Layer.succeed(TeamRelayPresence, {
      resolveRemoteEnvironmentPresence: () => Effect.succeed(remotePresenceState),
    } as unknown as TeamRelayPresence["Service"]),
  );

describe("TeamPresenceResolverLive", () => {
  it.effect("falls back to remote presence for a roster agent with no local activity", () =>
    Effect.gen(function* () {
      const resolver = yield* TeamPresenceResolver;
      const state = yield* resolver.resolveMemberPresence({
        projectId,
        memberId: remoteAgentId,
        nowMs: yield* Clock.currentTimeMillis,
      });
      expect(state).toBe("busy");
    }).pipe(Effect.provide(TeamPresenceResolverLive.pipe(Layer.provide(testLayer("busy"))))),
  );

  it.effect("returns null for a local agent with no thread activity and no remote data", () =>
    Effect.gen(function* () {
      const resolver = yield* TeamPresenceResolver;
      const state = yield* resolver.resolveMemberPresence({
        projectId,
        memberId: localAgentId,
        nowMs: yield* Clock.currentTimeMillis,
      });
      expect(state).toBeNull();
    }).pipe(Effect.provide(TeamPresenceResolverLive.pipe(Layer.provide(testLayer(null))))),
  );
});
