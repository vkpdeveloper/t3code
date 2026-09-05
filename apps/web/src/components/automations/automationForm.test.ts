import { describe, expect, it } from "vite-plus/test";
import {
  AutomationId,
  ProjectId,
  ProviderInstanceId,
  type Automation,
  type AutomationSchedule,
} from "@t3tools/contracts";

import {
  automationFormFromAutomation,
  automationInputFromForm,
  defaultAutomationForm,
} from "./automationForm";

const automation: Automation = {
  id: AutomationId.make("automation-1"),
  name: "Daily disk check",
  prompt: "Check free space and report what needs cleanup.",
  projectId: ProjectId.make("project-1"),
  schedule: { kind: "daily", time: "09:00", timeZone: "Asia/Kolkata" },
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex-personal"),
    model: "gpt-6-astra",
    options: [{ id: "reasoningEffort", value: "high" }],
  },
  runtimeMode: "approval-required",
  enabled: false,
  nextRunAt: null,
  createdAt: "2026-09-05T09:00:00Z",
  updatedAt: "2026-09-05T09:00:00Z",
  runs: [],
};

describe("automation editor", () => {
  it("changes permissions without resetting the model options, time zone, project, or paused state", () => {
    const input = automationInputFromForm({
      ...automationFormFromAutomation(automation),
      runtimeMode: "full-access",
    });
    expect(input).toEqual({
      name: automation.name,
      prompt: automation.prompt,
      projectId: automation.projectId,
      schedule: automation.schedule,
      modelSelection: automation.modelSelection,
      runtimeMode: "full-access",
      enabled: false,
    });
  });

  it.each<AutomationSchedule>([
    { kind: "hourly", minute: 47, timeZone: "America/New_York" },
    { kind: "daily", time: "23:15", timeZone: "Europe/London" },
    { kind: "weekdays", time: "08:30", timeZone: "Asia/Kolkata" },
    { kind: "weekly", weekday: "saturday", time: "10:45", timeZone: "Asia/Tokyo" },
    { kind: "weekly", weekday: "sunday", time: "11:00", timeZone: "UTC" },
  ])("preserves a saved $kind schedule when editing the instructions", (schedule) => {
    const input = automationInputFromForm({
      ...automationFormFromAutomation({ ...automation, schedule }),
      prompt: "New instructions",
    });
    expect(input?.schedule).toEqual(schedule);
    expect(input?.prompt).toBe("New instructions");
  });

  it("saves a new provider model and moves a job to the machine workspace", () => {
    const modelSelection = {
      instanceId: ProviderInstanceId.make("claude-work"),
      model: "claude-sonnet-4-6",
    };
    const input = automationInputFromForm({
      ...automationFormFromAutomation(automation),
      modelSelection,
      projectId: null,
      enabled: true,
    });
    expect(input).toMatchObject({ modelSelection, projectId: null, enabled: true });
    expect(input?.modelSelection).not.toHaveProperty("options");
  });

  it("starts a new job with fresh defaults after editing a paused job", () => {
    const form = defaultAutomationForm(automation.modelSelection, "UTC");
    expect(form).toMatchObject({
      name: "",
      prompt: "",
      enabled: true,
      projectId: null,
      runtimeMode: "full-access",
      timeZone: "UTC",
    });
    expect(automationInputFromForm(form)).toBeNull();
  });
});
