import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "automation_id")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN automation_id TEXT`;
  }
  if (!columns.some((column) => column.name === "automation_run_id")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN automation_run_id TEXT`;
  }

  yield* sql`
    CREATE TABLE IF NOT EXISTS automations (
      automation_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      project_id TEXT,
      schedule_json TEXT NOT NULL,
      model_selection_json TEXT NOT NULL,
      runtime_mode TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      next_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS automation_runs (
      run_id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL REFERENCES automations(automation_id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL UNIQUE,
      trigger TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      UNIQUE(automation_id, trigger, scheduled_for)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automations_due
    ON automations(enabled, next_run_at)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_runs_automation
    ON automation_runs(automation_id, scheduled_for DESC)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_automation
    ON projection_threads(automation_id, created_at DESC)
  `;
});
