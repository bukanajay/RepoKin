/**
 * AgentForge agent profile write command.
 *
 * @module AgentUpsert
 */
import {
  TeamAgentUpsertError,
  type TeamAgentUpsertInput,
  type TeamAgentUpsertResult,
} from "@t3tools/contracts/team";
import * as Effect from "effect/Effect";

import { TeamFileStore } from "./Services/TeamFileStore.ts";

export const upsertTeamAgent = Effect.fn("TeamAgent.upsert")(function* (
  input: TeamAgentUpsertInput,
): Effect.fn.Return<TeamAgentUpsertResult, TeamAgentUpsertError, TeamFileStore> {
  const store = yield* TeamFileStore;
  const write = yield* store
    .writeAgentProfile(input.cwd, input.profile, {
      commit: input.commit ?? false,
      fileSlug: input.profile.id,
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new TeamAgentUpsertError({
            reason: "write-failed",
            cwd: input.cwd,
            agentId: input.profile.id,
            message: "Failed to write AgentForge agent profile.",
            cause,
          }),
      ),
    );

  const roster = yield* store.readRoster(input.cwd).pipe(
    Effect.mapError(
      (cause) =>
        new TeamAgentUpsertError({
          reason: "roster-read-failed",
          cwd: input.cwd,
          agentId: input.profile.id,
          message: "Saved the agent profile, but failed to refresh the roster.",
          cause,
        }),
    ),
  );

  return { write, roster };
});
