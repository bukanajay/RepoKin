import type { ProjectId } from "@t3tools/contracts";
import type { TeamWorkMapReadResult, TeamWorkSignal } from "@t3tools/contracts/team";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface TeamWorkSignalsShape {
  /**
   * Live work-map projection for a project: local signals (working tree +
   * running agent threads) merged with any cached remote signals, when
   * work-location sharing is enabled (FR-14.4). Failures (git/status, snapshot)
   * are absorbed into an empty map so the RPC stays infallible for the UI.
   */
  readonly readWorkMap: (projectId: ProjectId) => Effect.Effect<TeamWorkMapReadResult>;
  /**
   * Ingest a remote environment's work-signal snapshot (cross-env fan-out).
   * No-op when sharing is disabled on this environment for privacy symmetry.
   */
  readonly ingestRemoteSignals: (signals: ReadonlyArray<TeamWorkSignal>) => Effect.Effect<void>;
}

export class TeamWorkSignals extends Context.Service<TeamWorkSignals, TeamWorkSignalsShape>()(
  "t3/team/Services/TeamWorkSignals",
) {}
