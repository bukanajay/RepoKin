import type { TeamRosterSyncResult } from "@t3tools/contracts/team";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class TeamRosterSyncOperationError extends Schema.TaggedErrorClass<TeamRosterSyncOperationError>()(
  "TeamRosterSyncOperationError",
  {
    operation: Schema.Literals([
      "read-local-roster",
      "resolve-default-branch",
      "fetch-remote-roster",
      "read-remote-roster",
    ]),
    cwd: Schema.String,
    remote: Schema.optionalKey(Schema.String),
    branch: Schema.optionalKey(Schema.String),
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export const isTeamRosterSyncOperationError = Schema.is(TeamRosterSyncOperationError);

export interface TeamRosterRemoteSelection {
  readonly remote: string;
  readonly source: "team-file" | "suggested-default";
  readonly requiresConfirmation: boolean;
}

export interface RosterSyncShape {
  readonly suggestTeamRemote: (
    remotes: ReadonlyArray<{ readonly name: string }>,
  ) => TeamRosterRemoteSelection | null;

  readonly syncProjectRoster: (
    cwd: string,
  ) => Effect.Effect<TeamRosterSyncResult, TeamRosterSyncOperationError>;

  readonly syncProjectRosterIfVisible: (
    cwd: string,
  ) => Effect.Effect<TeamRosterSyncResult | null, TeamRosterSyncOperationError>;

  readonly retainProjectSync: (input: {
    readonly cwd: string;
    readonly automaticRosterSyncInterval?: Effect.Effect<Duration.Duration, never>;
  }) => Effect.Effect<Effect.Effect<void>>;
}

export class RosterSync extends Context.Service<RosterSync, RosterSyncShape>()(
  "t3/team/Services/RosterSync",
) {}
