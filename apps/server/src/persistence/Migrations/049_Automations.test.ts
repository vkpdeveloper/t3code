import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("049_Automations", (it) => {
  it.effect("adds durable schedules, runs, and thread ownership", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 48 });
      yield* runMigrations({ toMigrationInclusive: 49 });

      const threadColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table'
      `;

      assert.isTrue(threadColumns.some((column) => column.name === "automation_id"));
      assert.isTrue(threadColumns.some((column) => column.name === "automation_run_id"));
      assert.isTrue(tables.some((table) => table.name === "automations"));
      assert.isTrue(tables.some((table) => table.name === "automation_runs"));
    }),
  );
});
