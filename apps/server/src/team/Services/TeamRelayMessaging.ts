import type { MessageId, ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface TeamRelayMessagingShape {
  /**
   * Signs and forwards a locally queued message through the relay when its
   * recipient's roster-declared home environment is not this environment.
   * A no-op (never fails, never surfaced) when relay link credentials are
   * absent, the recipient is local, or the message is not queued.
   */
  readonly forwardQueuedMessage: (input: {
    readonly projectId: ProjectId;
    readonly messageId: MessageId;
  }) => Effect.Effect<void>;

  /**
   * Polls the relay once for envelopes queued for this environment, verifies
   * each against the owning project's roster, and dispatches accepted
   * envelopes into the local team engine. Dropped envelopes are logged only.
   */
  readonly pollInbound: () => Effect.Effect<void>;
}

export class TeamRelayMessaging extends Context.Service<
  TeamRelayMessaging,
  TeamRelayMessagingShape
>()("t3/team/Services/TeamRelayMessaging") {}
