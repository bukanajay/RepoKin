import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createTeamEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    roster: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:team:roster",
      tag: WS_METHODS.teamReadRoster,
      staleTimeMs: 5_000,
    }),
    upsertAgent: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team:agent-upsert",
      tag: WS_METHODS.teamUpsertAgent,
    }),
    updateTeamFile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team:team-file-update",
      tag: WS_METHODS.teamUpdateTeamFile,
    }),
    instructionPreview: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:team:instruction-preview",
      tag: WS_METHODS.teamPreviewInstructions,
      staleTimeMs: 5_000,
    }),
    syncRoster: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team:roster-sync",
      tag: WS_METHODS.teamSyncRoster,
    }),
    localState: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:team:local-state",
      tag: WS_METHODS.teamReadLocalState,
      staleTimeMs: 1_000,
    }),
    // Reactive newest-window of a channel's posts (before=null); refreshes as
    // new posts land so the channel tail stays live.
    channelPosts: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:team:channel-posts",
      tag: WS_METHODS.teamReadChannelPosts,
      staleTimeMs: 1_000,
    }),
    // Imperative fetch for older windows (channel history is immutable, so
    // paged results are held in component state rather than re-queried).
    readChannelPosts: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team:channel-posts-read",
      tag: WS_METHODS.teamReadChannelPosts,
    }),
    dispatchCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team:dispatch-command",
      tag: WS_METHODS.teamDispatchCommand,
    }),
    heartbeatHumanPresence: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team:human-presence-heartbeat",
      tag: WS_METHODS.teamHeartbeatHumanPresence,
    }),
  };
}
