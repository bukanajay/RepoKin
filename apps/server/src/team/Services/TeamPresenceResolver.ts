import type { MemberId, MemberPresenceState } from "@t3tools/contracts/team";
import type { ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface TeamPresenceResolverShape {
  readonly resolveMemberPresence: (input: {
    readonly projectId: ProjectId;
    readonly memberId: MemberId;
    readonly nowMs: number;
  }) => Effect.Effect<MemberPresenceState | null, ProjectionRepositoryError>;
}

export class TeamPresenceResolver extends Context.Service<
  TeamPresenceResolver,
  TeamPresenceResolverShape
>()("t3/team/Services/TeamPresenceResolver") {}
