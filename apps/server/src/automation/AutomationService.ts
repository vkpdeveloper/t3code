// @effect-diagnostics globalDate:off globalDateInEffect:off preferSchemaOverJson:off -- persisted JSON uses contract-validated values, and Intl schedule conversion accepts native Date.
import {
  AUTOMATION_WORKSPACE_PROJECT_ID,
  AutomationId,
  AutomationOperationError,
  AutomationRunId,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type Automation,
  type AutomationCreateInput,
  type AutomationRun,
  type AutomationSchedule,
  type AutomationUpdateInput,
  type ModelSelection,
  ProjectId,
  type RuntimeMode,
  MessageId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { nextAutomationRunAt } from "./AutomationSchedule.ts";

interface AutomationRow {
  readonly automationId: string;
  readonly name: string;
  readonly prompt: string;
  readonly projectId: string | null;
  readonly scheduleJson: string;
  readonly modelSelectionJson: string;
  readonly runtimeMode: RuntimeMode;
  readonly enabled: number;
  readonly nextRunAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface AutomationRunRow {
  readonly runId: string;
  readonly automationId: string;
  readonly threadId: string;
  readonly trigger: "scheduled" | "manual";
  readonly scheduledFor: string;
  readonly status: "pending" | "started" | "failed";
  readonly error: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function operationError(cause: unknown): AutomationOperationError {
  return new AutomationOperationError({ message: errorMessage(cause) });
}

function parseJson<A>(value: string): A {
  return JSON.parse(value) as A;
}

function mapRun(row: AutomationRunRow): AutomationRun {
  return {
    id: AutomationRunId.make(row.runId),
    automationId: AutomationId.make(row.automationId),
    threadId: ThreadId.make(row.threadId),
    trigger: row.trigger,
    scheduledFor: row.scheduledFor,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
  };
}

function mapAutomation(row: AutomationRow, runs: ReadonlyArray<AutomationRunRow>): Automation {
  return {
    id: AutomationId.make(row.automationId),
    name: row.name,
    prompt: row.prompt,
    projectId: row.projectId === null ? null : (ProjectId.make(row.projectId) as ProjectId),
    schedule: parseJson<AutomationSchedule>(row.scheduleJson),
    modelSelection: parseJson<ModelSelection>(row.modelSelectionJson),
    runtimeMode: row.runtimeMode,
    enabled: row.enabled === 1,
    nextRunAt: row.nextRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    runs: runs.filter((run) => run.automationId === row.automationId).map(mapRun),
  };
}

export interface AutomationServiceShape {
  readonly list: Effect.Effect<
    { readonly automations: ReadonlyArray<Automation> },
    AutomationOperationError
  >;
  readonly create: (
    input: AutomationCreateInput,
  ) => Effect.Effect<Automation, AutomationOperationError>;
  readonly update: (
    input: AutomationUpdateInput,
  ) => Effect.Effect<Automation, AutomationOperationError>;
  readonly remove: (id: AutomationId) => Effect.Effect<{}, AutomationOperationError>;
  readonly runNow: (id: AutomationId) => Effect.Effect<Automation, AutomationOperationError>;
}

export class AutomationService extends Context.Service<AutomationService, AutomationServiceShape>()(
  "t3/automation/AutomationService",
) {}

export const layer = Layer.effect(
  AutomationService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const crypto = yield* Crypto.Crypto;
    const engine = yield* OrchestrationEngineService;
    const query = yield* ProjectionSnapshotQuery;
    const config = yield* ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
    const uuid = crypto.randomUUIDv4;

    const readRows = Effect.gen(function* () {
      const automations = yield* sql<AutomationRow>`
        SELECT automation_id AS "automationId", name, prompt, project_id AS "projectId",
          schedule_json AS "scheduleJson", model_selection_json AS "modelSelectionJson",
          runtime_mode AS "runtimeMode", enabled, next_run_at AS "nextRunAt",
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM automations
        ORDER BY created_at DESC, automation_id DESC
      `;
      const runs = yield* sql<AutomationRunRow>`
        SELECT run_id AS "runId", automation_id AS "automationId", thread_id AS "threadId",
          trigger, scheduled_for AS "scheduledFor", status, error,
          created_at AS "createdAt", started_at AS "startedAt"
        FROM automation_runs
        ORDER BY scheduled_for DESC, run_id DESC
      `;
      return automations.map((automation) => mapAutomation(automation, runs));
    });

    const getOne = Effect.fn("AutomationService.getOne")(function* (id: AutomationId) {
      const automations = yield* readRows;
      const automation = automations.find((candidate) => candidate.id === id);
      if (automation === undefined) {
        return yield* new AutomationOperationError({ message: "Automation not found." });
      }
      return automation;
    });

    const validateProject = Effect.fn("AutomationService.validateProject")(function* (
      projectId: ProjectId | null,
    ) {
      if (projectId === null) return;
      const project = yield* query.getProjectShellById(projectId);
      if (Option.isNone(project)) {
        return yield* new AutomationOperationError({
          message: "The selected project is unavailable.",
        });
      }
    });

    const writeNextRun = (schedule: AutomationSchedule, after: string) =>
      Effect.try({
        try: () => nextAutomationRunAt(schedule, new Date(after)).toISOString(),
        catch: operationError,
      });

    const claimRun = Effect.fn("AutomationService.claimRun")(function* (
      automationId: AutomationId,
      trigger: "scheduled" | "manual",
      scheduledFor: string,
    ) {
      const runId = AutomationRunId.make(yield* uuid);
      const threadId = ThreadId.make(yield* uuid);
      const createdAt = yield* nowIso;
      yield* sql`
        INSERT OR IGNORE INTO automation_runs (
          run_id, automation_id, thread_id, trigger, scheduled_for, status, created_at
        ) VALUES (
          ${runId}, ${automationId}, ${threadId}, ${trigger}, ${scheduledFor}, 'pending', ${createdAt}
        )
      `;
    });

    const ensureMachineProject = Effect.fn("AutomationService.ensureMachineProject")(function* () {
      const existing = yield* query.getProjectShellById(AUTOMATION_WORKSPACE_PROJECT_ID);
      if (Option.isSome(existing)) return;
      const workspaceRoot = path.join(config.stateDir, "automations");
      yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });
      const createdAt = yield* nowIso;
      yield* engine.dispatch({
        type: "project.create",
        commandId: CommandId.make(`automation:project:${createdAt}`),
        projectId: AUTOMATION_WORKSPACE_PROJECT_ID,
        title: "Machine automations",
        workspaceRoot,
        createWorkspaceRootIfMissing: true,
        createdAt,
      });
    });

    const processRun = Effect.fn("AutomationService.processRun")(function* (run: AutomationRunRow) {
      const automation = yield* getOne(AutomationId.make(run.automationId));
      if (automation.projectId === null) yield* ensureMachineProject();
      const projectId = automation.projectId ?? AUTOMATION_WORKSPACE_PROJECT_ID;
      const createdAt = run.createdAt;
      const runId = AutomationRunId.make(run.runId);
      const threadId = ThreadId.make(run.threadId);
      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make(`automation:${run.runId}:create`),
        threadId,
        projectId,
        title: automation.name,
        modelSelection: automation.modelSelection,
        runtimeMode: automation.runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        automationId: automation.id,
        automationRunId: runId,
        createdAt,
      });
      yield* engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(`automation:${run.runId}:start`),
        threadId,
        message: {
          messageId: MessageId.make(`automation:${run.runId}:message`),
          role: "user",
          text: automation.prompt,
          attachments: [],
        },
        modelSelection: automation.modelSelection,
        runtimeMode: automation.runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt,
      });
      const startedAt = yield* nowIso;
      yield* sql`
        UPDATE automation_runs
        SET status = 'started', started_at = ${startedAt}, error = NULL
        WHERE run_id = ${run.runId}
      `;
    });

    const processPending = Effect.gen(function* () {
      const pending = yield* sql<AutomationRunRow>`
        SELECT run_id AS "runId", automation_id AS "automationId", thread_id AS "threadId",
          trigger, scheduled_for AS "scheduledFor", status, error,
          created_at AS "createdAt", started_at AS "startedAt"
        FROM automation_runs
        WHERE status = 'pending'
        ORDER BY created_at ASC
      `;
      yield* Effect.forEach(
        pending,
        (run) =>
          processRun(run).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause)
                : sql`
                    UPDATE automation_runs
                    SET status = 'failed', error = ${Cause.pretty(cause)}
                    WHERE run_id = ${run.runId}
                  `.pipe(Effect.asVoid),
            ),
          ),
        { concurrency: 1, discard: true },
      );
    });

    const scheduleDueRuns = Effect.gen(function* () {
      const now = yield* nowIso;
      const due = yield* sql<AutomationRow>`
        SELECT automation_id AS "automationId", name, prompt, project_id AS "projectId",
          schedule_json AS "scheduleJson", model_selection_json AS "modelSelectionJson",
          runtime_mode AS "runtimeMode", enabled, next_run_at AS "nextRunAt",
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM automations
        WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ${now}
        ORDER BY next_run_at ASC
      `;
      for (const row of due) {
        if (row.nextRunAt === null) continue;
        const schedule = parseJson<AutomationSchedule>(row.scheduleJson);
        const nextRunAt = nextAutomationRunAt(schedule, new Date(now)).toISOString();
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* claimRun(AutomationId.make(row.automationId), "scheduled", row.nextRunAt!);
            yield* sql`
              UPDATE automations SET next_run_at = ${nextRunAt}, updated_at = ${now}
              WHERE automation_id = ${row.automationId}
            `;
          }),
        );
      }
    });

    const tick = scheduleDueRuns.pipe(
      Effect.andThen(processPending),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("automation scheduler tick failed", { cause: Cause.pretty(cause) }),
      ),
    );
    yield* tick.pipe(Effect.repeat(Schedule.spaced(Duration.seconds(15))), Effect.forkScoped);

    const list: AutomationServiceShape["list"] = readRows.pipe(
      Effect.map((automations) => ({ automations })),
      Effect.mapError(operationError),
    );

    const create: AutomationServiceShape["create"] = (input) =>
      Effect.gen(function* () {
        yield* validateProject(input.projectId);
        const id = AutomationId.make(yield* uuid);
        const createdAt = yield* nowIso;
        const nextRunAt = input.enabled ? yield* writeNextRun(input.schedule, createdAt) : null;
        yield* sql`
          INSERT INTO automations (
            automation_id, name, prompt, project_id, schedule_json, model_selection_json,
            runtime_mode, enabled, next_run_at, created_at, updated_at
          ) VALUES (
            ${id}, ${input.name}, ${input.prompt}, ${input.projectId},
            ${JSON.stringify(input.schedule)}, ${JSON.stringify(input.modelSelection)},
            ${input.runtimeMode}, ${input.enabled ? 1 : 0}, ${nextRunAt}, ${createdAt}, ${createdAt}
          )
        `;
        return yield* getOne(id);
      }).pipe(Effect.mapError(operationError));

    const update: AutomationServiceShape["update"] = (input) =>
      Effect.gen(function* () {
        yield* getOne(input.id);
        yield* validateProject(input.projectId);
        const updatedAt = yield* nowIso;
        const nextRunAt = input.enabled ? yield* writeNextRun(input.schedule, updatedAt) : null;
        yield* sql`
          UPDATE automations SET
            name = ${input.name}, prompt = ${input.prompt}, project_id = ${input.projectId},
            schedule_json = ${JSON.stringify(input.schedule)},
            model_selection_json = ${JSON.stringify(input.modelSelection)},
            runtime_mode = ${input.runtimeMode}, enabled = ${input.enabled ? 1 : 0},
            next_run_at = ${nextRunAt}, updated_at = ${updatedAt}
          WHERE automation_id = ${input.id}
        `;
        return yield* getOne(input.id);
      }).pipe(Effect.mapError(operationError));

    const remove: AutomationServiceShape["remove"] = (id) =>
      Effect.gen(function* () {
        yield* getOne(id);
        yield* sql`DELETE FROM automations WHERE automation_id = ${id}`;
        return {};
      }).pipe(Effect.mapError(operationError));

    const runNow: AutomationServiceShape["runNow"] = (id) =>
      Effect.gen(function* () {
        yield* getOne(id);
        yield* claimRun(id, "manual", yield* nowIso);
        yield* processPending;
        return yield* getOne(id);
      }).pipe(Effect.mapError(operationError));

    return { list, create, update, remove, runNow } satisfies AutomationServiceShape;
  }),
);
