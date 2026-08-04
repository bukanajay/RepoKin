import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Fork lineage repair. Databases created before the Aug-03 upstream sync
 * recorded migration id 35 as the fork's attribution migration (then named
 * "ProjectionThreadsAgentForgeAttribution", with a differently named column),
 * so on those databases the upstream 35_ProjectionThreadTitleRegeneration is
 * skipped as already applied. This migration re-ensures every column either
 * lineage may be missing; each ALTER is guarded, so it is a no-op where the
 * schema is already current.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  const hasColumn = (name: string) => columns.some((column) => column.name === name);

  if (!hasColumn("repokin_agent_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN repokin_agent_id TEXT
    `;
  }

  if (!hasColumn("title_regeneration_request_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN title_regeneration_request_id TEXT
    `;
  }

  if (!hasColumn("title_regeneration_started_at")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN title_regeneration_started_at TEXT
    `;
  }
});
