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
    dispatchCommand: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team:dispatch-command",
      tag: WS_METHODS.teamDispatchCommand,
    }),
  };
}
