import type { EnvironmentId } from "@t3tools/contracts";
import type { MemberPresenceState } from "@t3tools/contracts/team";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface TeamRelayPresenceShape {
  /**
   * Coarse presence for a roster agent's home environment, derived from
   * activity that environment already published to the relay. Returns null
   * when relay link credentials are absent or nothing has been published for
   * that environment — never surfaced as an error, presence is best-effort.
   */
  readonly resolveRemoteEnvironmentPresence: (input: {
    readonly environmentId: EnvironmentId;
    readonly nowMs: number;
  }) => Effect.Effect<MemberPresenceState | null>;
}

export class TeamRelayPresence extends Context.Service<TeamRelayPresence, TeamRelayPresenceShape>()(
  "t3/team/Services/TeamRelayPresence",
) {}
