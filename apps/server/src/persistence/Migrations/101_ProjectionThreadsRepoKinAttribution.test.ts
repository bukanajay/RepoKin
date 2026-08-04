import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
// Separate in-memory database: the repair scenario needs its own migration
// history and would conflict with the block above.
const repairLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("101_ProjectionThreadsRepoKinAttribution", (it) => {
  it.effect("adds nullable RepoKin owner column to existing thread projections", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 100 });
      yield* runMigrations({ toMigrationInclusive: 101 });

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_threads)
      `;
      const column = columns.find((entry) => entry.name === "repokin_agent_id");

      assert.ok(column);
      assert.strictEqual(column.notnull, 0);
    }),
  );
});

repairLayer("101_ProjectionThreadsRepoKinAttribution lineage repair", (it) => {
  it.effect("repairs pre-sync fork databases missing the title regeneration columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // Simulate a fork database from before the upstream 35 collision: the
      // title regeneration columns are absent while id 35 is already recorded.
      yield* runMigrations({ toMigrationInclusive: 34 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name, created_at)
        VALUES (35, 'ProjectionThreadsAgentForgeAttribution', '2026-07-31 00:00:00')
      `;
      yield* runMigrations({ toMigrationInclusive: 101 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      const names = columns.map((entry) => entry.name);

      assert.include(names, "repokin_agent_id");
      assert.include(names, "title_regeneration_request_id");
      assert.include(names, "title_regeneration_started_at");
    }),
  );
});
