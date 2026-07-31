import type { ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface TeamInboxDeliveryReactorShape {
  readonly enqueueProject: (projectId: ProjectId) => Effect.Effect<void>;
  readonly drain: Effect.Effect<void>;
}

export class TeamInboxDeliveryReactor extends Context.Service<
  TeamInboxDeliveryReactor,
  TeamInboxDeliveryReactorShape
>()("t3/team/Services/TeamInboxDeliveryReactor") {}
