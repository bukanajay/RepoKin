/**
 * RepoKin roster read query.
 *
 * @module RosterRead
 */
import {
  TeamRosterReadError,
  type TeamRosterReadInput,
  type TeamRosterReadModel,
} from "@t3tools/contracts/team";
import * as Effect from "effect/Effect";

import { TeamFileStore } from "./Services/TeamFileStore.ts";

export const readTeamRoster = Effect.fn("TeamRoster.read")(function* (
  input: TeamRosterReadInput,
): Effect.fn.Return<TeamRosterReadModel, TeamRosterReadError, TeamFileStore> {
  const store = yield* TeamFileStore;
  return yield* store.readRoster(input.cwd).pipe(
    Effect.mapError(
      (cause) =>
        new TeamRosterReadError({
          cwd: input.cwd,
          message: "Failed to read RepoKin roster.",
          cause,
        }),
    ),
  );
});
