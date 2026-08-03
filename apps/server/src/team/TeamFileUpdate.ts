/**
 * RepoKin team file write command.
 *
 * @module TeamFileUpdate
 */
import {
  TeamFileUpdateError,
  type TeamFileUpdateInput,
  type TeamFileUpdateResult,
} from "@t3tools/contracts/team";
import * as Effect from "effect/Effect";

import { TeamFileStore } from "./Services/TeamFileStore.ts";

export const updateTeamFile = Effect.fn("TeamFile.update")(function* (
  input: TeamFileUpdateInput,
): Effect.fn.Return<TeamFileUpdateResult, TeamFileUpdateError, TeamFileStore> {
  const store = yield* TeamFileStore;
  const write = yield* store
    .writeTeamFile(input.cwd, input.team, {
      commit: input.commit ?? false,
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new TeamFileUpdateError({
            reason: "write-failed",
            cwd: input.cwd,
            message: "Failed to write RepoKin team file.",
            cause,
          }),
      ),
    );

  const roster = yield* store.readRoster(input.cwd).pipe(
    Effect.mapError(
      (cause) =>
        new TeamFileUpdateError({
          reason: "roster-read-failed",
          cwd: input.cwd,
          message: "Saved the team file, but failed to refresh the roster.",
          cause,
        }),
    ),
  );

  return { write, roster };
});
