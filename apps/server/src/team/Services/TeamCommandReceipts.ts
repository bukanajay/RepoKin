import type { CommandId, ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type { TeamCommandReceiptRepositoryError } from "../../persistence/Errors.ts";

export type TeamCommandReceiptStatus = "accepted" | "rejected";

export interface TeamCommandReceipt {
  readonly commandId: CommandId;
  readonly aggregateId: ProjectId;
  readonly acceptedAt: string;
  readonly resultSequence: number;
  readonly status: TeamCommandReceiptStatus;
  readonly error: string | null;
}

export interface TeamCommandReceiptRepositoryShape {
  readonly getByCommandId: (input: {
    readonly commandId: CommandId;
  }) => Effect.Effect<Option.Option<TeamCommandReceipt>, TeamCommandReceiptRepositoryError>;

  readonly upsert: (
    receipt: TeamCommandReceipt,
  ) => Effect.Effect<void, TeamCommandReceiptRepositoryError>;
}

export class TeamCommandReceiptRepository extends Context.Service<
  TeamCommandReceiptRepository,
  TeamCommandReceiptRepositoryShape
>()("t3/team/Services/TeamCommandReceipts/TeamCommandReceiptRepository") {}
