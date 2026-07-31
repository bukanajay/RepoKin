import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS team_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      aggregate_kind TEXT NOT NULL,
      stream_id TEXT NOT NULL,
      stream_version INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      command_id TEXT NOT NULL,
      causation_event_id TEXT,
      correlation_id TEXT,
      event_json TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_team_events_stream_version
    ON team_events(aggregate_kind, stream_id, stream_version)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_team_events_stream_sequence
    ON team_events(aggregate_kind, stream_id, sequence)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_team_events_command_id
    ON team_events(command_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS team_command_receipts (
      command_id TEXT PRIMARY KEY,
      aggregate_id TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      result_sequence INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT
    )
  `;
});
