import * as Schema from "effect/Schema";

import {
  AutomationId,
  AutomationRunId,
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection, RuntimeMode } from "./orchestration.ts";

export const AUTOMATION_WORKSPACE_PROJECT_ID = ProjectId.make("t3-automation-workspace");

export const AutomationWeekday = Schema.Literals([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);
export type AutomationWeekday = typeof AutomationWeekday.Type;

const AutomationTimeZone = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
const AutomationLocalTime = Schema.String.check(Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/));
const AutomationMinute = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 59 }));

export const AutomationSchedule = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("hourly"),
    minute: AutomationMinute,
    timeZone: AutomationTimeZone,
  }),
  Schema.Struct({
    kind: Schema.Literal("daily"),
    time: AutomationLocalTime,
    timeZone: AutomationTimeZone,
  }),
  Schema.Struct({
    kind: Schema.Literal("weekdays"),
    time: AutomationLocalTime,
    timeZone: AutomationTimeZone,
  }),
  Schema.Struct({
    kind: Schema.Literal("weekly"),
    weekday: AutomationWeekday,
    time: AutomationLocalTime,
    timeZone: AutomationTimeZone,
  }),
]);
export type AutomationSchedule = typeof AutomationSchedule.Type;

export const AutomationRunStatus = Schema.Literals(["pending", "started", "failed"]);
export type AutomationRunStatus = typeof AutomationRunStatus.Type;

export const AutomationRun = Schema.Struct({
  id: AutomationRunId,
  automationId: AutomationId,
  threadId: ThreadId,
  trigger: Schema.Literals(["scheduled", "manual"]),
  scheduledFor: IsoDateTime,
  status: AutomationRunStatus,
  error: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
});
export type AutomationRun = typeof AutomationRun.Type;

export const Automation = Schema.Struct({
  id: AutomationId,
  name: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  projectId: Schema.NullOr(ProjectId),
  schedule: AutomationSchedule,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  enabled: Schema.Boolean,
  nextRunAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  runs: Schema.Array(AutomationRun),
});
export type Automation = typeof Automation.Type;

export const AutomationListResult = Schema.Struct({ automations: Schema.Array(Automation) });

const AutomationWriteFields = {
  name: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  projectId: Schema.NullOr(ProjectId),
  schedule: AutomationSchedule,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  enabled: Schema.Boolean,
} as const;

export const AutomationCreateInput = Schema.Struct(AutomationWriteFields);
export type AutomationCreateInput = typeof AutomationCreateInput.Type;

export const AutomationUpdateInput = Schema.Struct({
  id: AutomationId,
  ...AutomationWriteFields,
});
export type AutomationUpdateInput = typeof AutomationUpdateInput.Type;

export const AutomationIdInput = Schema.Struct({ id: AutomationId });
export type AutomationIdInput = typeof AutomationIdInput.Type;

export class AutomationOperationError extends Schema.TaggedErrorClass<AutomationOperationError>()(
  "AutomationOperationError",
  { message: Schema.String },
) {}

export const AutomationEmptyResult = Schema.Struct({});
