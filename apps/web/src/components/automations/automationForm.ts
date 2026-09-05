import type {
  Automation,
  AutomationCreateInput,
  AutomationSchedule,
  AutomationWeekday,
  ModelSelection,
  ProjectId,
  RuntimeMode,
} from "@t3tools/contracts";

export interface AutomationFormState {
  readonly name: string;
  readonly prompt: string;
  readonly projectId: ProjectId | null;
  readonly scheduleKind: AutomationSchedule["kind"];
  readonly time: string;
  readonly minute: string;
  readonly weekday: AutomationWeekday;
  readonly timeZone: string;
  readonly modelSelection: ModelSelection | null;
  readonly runtimeMode: RuntimeMode;
  readonly enabled: boolean;
}

export function defaultAutomationForm(
  modelSelection: ModelSelection | null,
  timeZone: string,
): AutomationFormState {
  return {
    name: "",
    prompt: "",
    projectId: null,
    scheduleKind: "daily",
    time: "09:00",
    minute: "0",
    weekday: "monday",
    timeZone,
    modelSelection,
    runtimeMode: "full-access",
    enabled: true,
  };
}

export function automationFormFromAutomation(automation: Automation): AutomationFormState {
  const { schedule } = automation;
  return {
    ...defaultAutomationForm(automation.modelSelection, schedule.timeZone),
    name: automation.name,
    prompt: automation.prompt,
    projectId: automation.projectId,
    scheduleKind: schedule.kind,
    ...(schedule.kind === "hourly" ? { minute: String(schedule.minute) } : { time: schedule.time }),
    ...(schedule.kind === "weekly" ? { weekday: schedule.weekday } : {}),
    runtimeMode: automation.runtimeMode,
    enabled: automation.enabled,
  };
}

export function automationInputFromForm(form: AutomationFormState): AutomationCreateInput | null {
  if (form.modelSelection === null || form.name.trim() === "" || form.prompt.trim() === "") {
    return null;
  }
  const timeZone = form.timeZone.trim();
  const schedule: AutomationSchedule =
    form.scheduleKind === "hourly"
      ? { kind: "hourly", minute: Number(form.minute), timeZone }
      : form.scheduleKind === "weekly"
        ? { kind: "weekly", weekday: form.weekday, time: form.time, timeZone }
        : { kind: form.scheduleKind, time: form.time, timeZone };
  return {
    name: form.name.trim(),
    prompt: form.prompt.trim(),
    projectId: form.projectId,
    schedule,
    modelSelection: form.modelSelection,
    runtimeMode: form.runtimeMode,
    enabled: form.enabled,
  };
}
