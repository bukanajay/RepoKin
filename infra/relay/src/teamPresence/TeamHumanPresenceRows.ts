import { EnvironmentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { inArray, lt, sql } from "drizzle-orm";

import * as RelayDb from "../db.ts";
import { relayTeamHumanPresence } from "../persistence/schema.ts";

export class TeamHumanPresencePersistenceError extends Schema.TaggedErrorClass<TeamHumanPresencePersistenceError>()(
  "TeamHumanPresencePersistenceError",
  { cause: Schema.Defect() },
) {}

export interface TeamHumanPresenceEntry {
  readonly environmentId: EnvironmentId;
  readonly activeAt: string;
}

export class TeamHumanPresenceRows extends Context.Service<
  TeamHumanPresenceRows,
  {
    readonly heartbeat: (
      input: TeamHumanPresenceEntry,
    ) => Effect.Effect<void, TeamHumanPresencePersistenceError>;
    readonly getForEnvironments: (input: {
      readonly environmentIds: ReadonlyArray<EnvironmentId>;
    }) => Effect.Effect<ReadonlyArray<TeamHumanPresenceEntry>, TeamHumanPresencePersistenceError>;
    readonly pruneOlderThan: (input: {
      readonly cutoffIso: string;
    }) => Effect.Effect<void, TeamHumanPresencePersistenceError>;
  }
>()("t3code-relay/teamPresence/TeamHumanPresenceRows") {}

export const make = Effect.gen(function* () {
  const db = yield* RelayDb.RelayDb;
  const mapError = (cause: unknown) => new TeamHumanPresencePersistenceError({ cause });

  return TeamHumanPresenceRows.of({
    heartbeat: Effect.fn("relay.team_human_presence.heartbeat")(function* (input) {
      yield* db
        .insert(relayTeamHumanPresence)
        .values(input)
        .onConflictDoUpdate({
          target: relayTeamHumanPresence.environmentId,
          set: { activeAt: sql`excluded.active_at` },
        })
        .pipe(Effect.mapError(mapError));
    }),
    getForEnvironments: Effect.fn("relay.team_human_presence.get_for_environments")(
      function* (input) {
        if (input.environmentIds.length === 0) {
          return [];
        }
        return yield* db
          .select({
            environmentId: relayTeamHumanPresence.environmentId,
            activeAt: relayTeamHumanPresence.activeAt,
          })
          .from(relayTeamHumanPresence)
          .where(inArray(relayTeamHumanPresence.environmentId, input.environmentIds))
          .pipe(
            Effect.map((rows) =>
              rows.map((row) => ({
                ...row,
                environmentId: EnvironmentId.make(row.environmentId),
              })),
            ),
            Effect.mapError(mapError),
          );
      },
    ),
    pruneOlderThan: Effect.fn("relay.team_human_presence.prune_older_than")(function* (input) {
      yield* db
        .delete(relayTeamHumanPresence)
        .where(lt(relayTeamHumanPresence.activeAt, input.cutoffIso))
        .pipe(Effect.mapError(mapError));
    }),
  });
});

export const layer = Layer.effect(TeamHumanPresenceRows, make);
