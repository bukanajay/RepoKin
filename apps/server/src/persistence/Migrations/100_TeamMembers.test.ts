import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("100_TeamMembers", (it) => {
  it.effect("installs team event and command receipt tables after migration 35", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 35 });

      const before = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name IN ('team_events', 'team_command_receipts')
        ORDER BY name ASC
      `;
      assert.deepStrictEqual(before, []);

      yield* runMigrations({ toMigrationInclusive: 100 });

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name IN ('team_events', 'team_command_receipts')
        ORDER BY name ASC
      `;
      assert.deepStrictEqual(
        tables.map((table) => table.name),
        ["team_command_receipts", "team_events"],
      );

      const eventColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(team_events)
      `;
      assert.isTrue(eventColumns.some((column) => column.name === "event_json"));
      assert.isTrue(eventColumns.some((column) => column.name === "stream_version"));
    }),
  );
});
