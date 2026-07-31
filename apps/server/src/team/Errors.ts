import * as SchemaIssue from "effect/SchemaIssue";
import * as Schema from "effect/Schema";

import type {
  TeamCommandReceiptRepositoryError,
  TeamEventStoreError,
} from "../persistence/Errors.ts";

export class TeamCommandInvariantError extends Schema.TaggedErrorClass<TeamCommandInvariantError>()(
  "TeamCommandInvariantError",
  {
    commandType: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Team command invariant failed (${this.commandType}): ${this.detail}`;
  }
}

export class TeamCommandPreviouslyRejectedError extends Schema.TaggedErrorClass<TeamCommandPreviouslyRejectedError>()(
  "TeamCommandPreviouslyRejectedError",
  {
    commandId: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Team command previously rejected (${this.commandId}): ${this.detail}`;
  }
}

export class TeamProjectorDecodeError extends Schema.TaggedErrorClass<TeamProjectorDecodeError>()(
  "TeamProjectorDecodeError",
  {
    eventType: Schema.String,
    issue: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Team projector decode failed for ${this.eventType}: ${this.issue}`;
  }
}

export type TeamDispatchError =
  | TeamEventStoreError
  | TeamCommandReceiptRepositoryError
  | TeamCommandInvariantError
  | TeamCommandPreviouslyRejectedError
  | TeamProjectorDecodeError;

export function toTeamProjectorDecodeError(eventType: string) {
  return (error: Schema.SchemaError): TeamProjectorDecodeError =>
    new TeamProjectorDecodeError({
      eventType,
      issue: SchemaIssue.makeFormatterDefault()(error.issue),
      cause: error,
    });
}
