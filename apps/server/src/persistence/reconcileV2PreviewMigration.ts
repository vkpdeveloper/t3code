import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import ProjectionThreadBranchPullRequest from "./Migrations/053_ProjectionThreadBranchPullRequest.ts";
import ProjectionThreadsActiveOrderKey from "./Migrations/054_ProjectionThreadsActiveOrderKey.ts";
import ProjectionThreadPullRequests from "./Migrations/055_ProjectionThreadPullRequests.ts";
import ProjectionThreadMessageContext from "./Migrations/056_ProjectionThreadMessageContext.ts";
import ProjectionThreadTitleState from "./Migrations/058_ProjectionThreadTitleState.ts";
import PullRequestFilesViewed from "./Migrations/053_PullRequestFilesViewed.ts";

// Published V2 previews used 53 or 54 before the fork assigned those IDs to
// other released migrations. Move their ledger entries without replaying V2.
export const reconcileV2PreviewMigration = Effect.fn("reconcileV2PreviewMigration")(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const tables = yield* sql`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
      `;
      if (tables.length === 0) return [];
      const history = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 53
      `;
      const legacy = history.find(
        (row) =>
          row.name === "OrchestrationV2" && (row.migration_id === 53 || row.migration_id === 54),
      );
      if (!legacy) return [];
      const valid = history.every(
        (row) =>
          row === legacy ||
          (legacy.migration_id === 54 &&
            ((row.migration_id === 53 && row.name === "PullRequestFilesViewed") ||
              (row.migration_id === 55 && row.name === "RemoveRedundantProjectionIndexes"))),
      );
      if (!valid) {
        return yield* new Migrator.MigrationError({
          kind: "BadState",
          message: "Cannot upgrade V2 preview with unexpected later migrations.",
        });
      }

      yield* ProjectionThreadBranchPullRequest;
      yield* ProjectionThreadsActiveOrderKey;
      yield* ProjectionThreadPullRequests;
      yield* ProjectionThreadMessageContext;
      yield* ProjectionThreadTitleState;
      if (legacy.migration_id === 53) yield* PullRequestFilesViewed;

      // Move the highest IDs first to avoid collisions with the fork's sequence.
      if (legacy.migration_id === 54) {
        yield* sql`UPDATE effect_sql_migrations SET migration_id = 60 WHERE migration_id = 55 AND name = 'RemoveRedundantProjectionIndexes'`;
        yield* sql`UPDATE effect_sql_migrations SET migration_id = 59 WHERE migration_id = 53 AND name = 'PullRequestFilesViewed'`;
      }
      yield* sql`UPDATE effect_sql_migrations SET migration_id = 57 WHERE migration_id = ${legacy.migration_id} AND name = 'OrchestrationV2'`;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name) VALUES
          (53, 'ProjectionThreadBranchPullRequest'),
          (54, 'ProjectionThreadsActiveOrderKey'),
          (55, 'ProjectionThreadPullRequests'),
          (56, 'ProjectionThreadMessageContext'),
          (58, 'ProjectionThreadTitleState')
      `;
      if (legacy.migration_id === 53) {
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (59, 'PullRequestFilesViewed')`;
      }
      return [
        [53, "ProjectionThreadBranchPullRequest"],
        [54, "ProjectionThreadsActiveOrderKey"],
        [55, "ProjectionThreadPullRequests"],
        [56, "ProjectionThreadMessageContext"],
        [58, "ProjectionThreadTitleState"],
        ...(legacy.migration_id === 53 ? [[59, "PullRequestFilesViewed"] as const] : []),
      ] as const;
    }),
  );
});
