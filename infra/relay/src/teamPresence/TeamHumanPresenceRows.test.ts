import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as RelayDb from "../db.ts";
import * as TeamHumanPresenceRows from "./TeamHumanPresenceRows.ts";

describe("TeamHumanPresenceRows", () => {
  it.effect("upserts and reads an environment heartbeat", () => {
    let stored: { readonly environmentId: string; readonly activeAt: string } | null = null;
    const db = {
      insert: () => ({
        values: (value: typeof stored) => ({
          onConflictDoUpdate: () =>
            Effect.sync(() => {
              stored = value;
            }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => Effect.sync(() => (stored === null ? [] : [stored])),
        }),
      }),
      delete: () => ({ where: () => Effect.void }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const rows = yield* TeamHumanPresenceRows.TeamHumanPresenceRows;
      yield* rows.heartbeat({
        environmentId: EnvironmentId.make("env-human"),
        activeAt: "2026-08-03T00:00:00.000Z",
      });
      const result = yield* rows.getForEnvironments({
        environmentIds: [EnvironmentId.make("env-human")],
      });
      expect(result).toEqual([
        { environmentId: "env-human", activeAt: "2026-08-03T00:00:00.000Z" },
      ]);
    }).pipe(
      Effect.provide(
        TeamHumanPresenceRows.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, db))),
      ),
    );
  });
});
