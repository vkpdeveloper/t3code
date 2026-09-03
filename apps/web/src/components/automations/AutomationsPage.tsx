import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  Automation,
  AutomationCreateInput,
  AutomationSchedule,
  EnvironmentId,
  ModelSelection,
  ProjectId,
  RuntimeMode,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  AlarmClockIcon,
  CirclePauseIcon,
  Clock3Icon,
  MoreHorizontalIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { isElectron } from "../../env";
import { automationEnvironment, useAutomations } from "../../state/automations";
import { useProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

const MACHINE_PROJECT = "__machine__";

function messageFromUnknown(value: unknown): string {
  return value instanceof Error && value.message.trim() !== ""
    ? value.message
    : "The automation request failed.";
}

function scheduleLabel(schedule: AutomationSchedule): string {
  switch (schedule.kind) {
    case "hourly":
      return `Every hour at :${String(schedule.minute).padStart(2, "0")}`;
    case "daily":
      return `Daily at ${schedule.time}`;
    case "weekdays":
      return `Weekdays at ${schedule.time}`;
    case "weekly":
      return `${schedule.weekday[0]?.toUpperCase()}${schedule.weekday.slice(1)} at ${schedule.time}`;
  }
}

function dateLabel(value: string | null): string {
  if (value === null) return "Paused";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function runStatusLabel(run: Automation["runs"][number]): string {
  if (run.status === "pending") return "Queued";
  if (run.status === "failed") return "Failed";
  return "Started";
}

interface AutomationFormState {
  readonly name: string;
  readonly prompt: string;
  readonly projectId: string;
  readonly scheduleKind: AutomationSchedule["kind"];
  readonly time: string;
  readonly minute: string;
  readonly weekday: "monday" | "tuesday" | "wednesday" | "thursday" | "friday";
  readonly modelKey: string;
  readonly runtimeMode: RuntimeMode;
}

function defaultForm(modelKey: string): AutomationFormState {
  return {
    name: "",
    prompt: "",
    projectId: MACHINE_PROJECT,
    scheduleKind: "daily",
    time: "09:00",
    minute: "0",
    weekday: "monday",
    modelKey,
    runtimeMode: "full-access",
  };
}

export function AutomationsPage() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(
    primaryEnvironmentId ?? environments[0]?.environmentId ?? null,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useAutomations(environmentId);
  const createAutomation = useAtomCommand(automationEnvironment.create);
  const updateAutomation = useAtomCommand(automationEnvironment.update);
  const removeAutomation = useAtomCommand(automationEnvironment.remove);
  const runNow = useAtomCommand(automationEnvironment.runNow);

  useEffect(() => {
    if (environmentId === null && environments[0]) {
      setEnvironmentId(primaryEnvironmentId ?? environments[0].environmentId);
    }
  }, [environmentId, environments, primaryEnvironmentId]);

  const selectedEnvironment = environments.find(
    (environment) => environment.environmentId === environmentId,
  );
  const environmentProjects = projects.filter((project) => project.environmentId === environmentId);
  const models = useMemo(
    () =>
      (selectedEnvironment?.serverConfig?.providers ?? []).flatMap((provider) =>
        provider.enabled && provider.installed
          ? provider.models.map((model) => ({
              key: `${provider.instanceId}\u0000${model.slug}`,
              selection: {
                instanceId: provider.instanceId,
                model: model.slug,
              } satisfies ModelSelection,
              label: `${provider.displayName ?? provider.driver} · ${model.shortName ?? model.name}`,
            }))
          : [],
      ),
    [selectedEnvironment],
  );
  const [form, setForm] = useState<AutomationFormState>(() => defaultForm(""));
  useEffect(() => {
    if (form.modelKey === "" && models[0]) {
      setForm((current) => ({ ...current, modelKey: models[0]!.key }));
    }
  }, [form.modelKey, models]);

  const mutate = async <A, E>(id: string, action: () => Promise<AtomCommandResult<A, E>>) => {
    setWorkingId(id);
    setError(null);
    const result = await action();
    setWorkingId(null);
    if (result._tag === "Success") {
      return true;
    }
    setError(messageFromUnknown(squashAtomCommandFailure(result)));
    return false;
  };

  const submit = async () => {
    if (environmentId === null) return;
    const model = models.find((candidate) => candidate.key === form.modelKey);
    if (!model || form.name.trim() === "" || form.prompt.trim() === "") {
      setError("Name, instructions, and a model are required.");
      return;
    }
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const schedule: AutomationSchedule =
      form.scheduleKind === "hourly"
        ? { kind: "hourly", minute: Number(form.minute), timeZone }
        : form.scheduleKind === "weekly"
          ? { kind: "weekly", weekday: form.weekday, time: form.time, timeZone }
          : { kind: form.scheduleKind, time: form.time, timeZone };
    const input: AutomationCreateInput = {
      name: form.name.trim(),
      prompt: form.prompt.trim(),
      projectId: form.projectId === MACHINE_PROJECT ? null : (form.projectId as ProjectId),
      schedule,
      modelSelection: model.selection,
      runtimeMode: form.runtimeMode,
      enabled: true,
    };
    const succeeded = await mutate("create", () => createAutomation({ environmentId, input }));
    if (succeeded) {
      setForm(defaultForm(models[0]?.key ?? ""));
    }
  };

  const toggle = (automation: Automation) => {
    if (environmentId === null) return;
    void mutate(automation.id, () =>
      updateAutomation({
        environmentId,
        input: {
          id: automation.id,
          name: automation.name,
          prompt: automation.prompt,
          projectId: automation.projectId,
          schedule: automation.schedule,
          modelSelection: automation.modelSelection,
          runtimeMode: automation.runtimeMode,
          enabled: !automation.enabled,
        },
      }),
    );
  };

  const topbar = (
    <div className="flex w-full min-w-0 items-center gap-3">
      <WorkspaceBreadcrumb ariaLabel="Automations breadcrumb">
        <WorkspaceBreadcrumbItem current>
          <h1>Automations</h1>
        </WorkspaceBreadcrumbItem>
      </WorkspaceBreadcrumb>
      <div className="ms-auto flex items-center gap-2">
        <Select
          value={environmentId}
          onValueChange={(value) => setEnvironmentId(value as EnvironmentId)}
        >
          <SelectTrigger className="w-36" size="compact" variant="ghost">
            <SelectValue>{selectedEnvironment?.label ?? "Machine"}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end">
            {environments.map((environment) => (
              <SelectItem key={environment.environmentId} value={environment.environmentId}>
                {environment.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          disabled={environmentId === null || models.length === 0}
          onClick={() => {
            setError(null);
            setDialogOpen(true);
          }}
          size="sm"
        >
          <PlusIcon /> New automation
        </Button>
      </div>
    </div>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspacePageHeader electron={isElectron}>{topbar}</WorkspacePageHeader>
        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide">
            {error ? (
              <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}
            {query.isPending && query.data === null ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                Loading automations…
              </div>
            ) : query.data?.automations.length ? (
              <div className="overflow-hidden rounded-xl border">
                {query.data.automations.map((automation, index) => {
                  const project = environmentProjects.find(
                    (candidate) => candidate.id === automation.projectId,
                  );
                  const latestRun = automation.runs[0];
                  return (
                    <div
                      className={`grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.5fr)_minmax(10rem,1fr)_minmax(9rem,.8fr)_auto] md:items-center ${index > 0 ? "border-t" : ""}`}
                      key={automation.id}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <AlarmClockIcon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm font-medium">{automation.name}</span>
                          {!automation.enabled ? (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              Paused
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 truncate ps-6 text-xs text-muted-foreground">
                          {project?.title ?? "Machine workspace"} ·{" "}
                          {automation.modelSelection.model}
                        </div>
                      </div>
                      <div className="text-xs">
                        <div className="font-medium">{scheduleLabel(automation.schedule)}</div>
                        <div className="mt-1 text-muted-foreground">
                          Next: {dateLabel(automation.nextRunAt)}
                        </div>
                      </div>
                      <div className="text-xs">
                        {latestRun ? (
                          <Link
                            className="group inline-flex items-center gap-1.5 rounded outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                            to="/$environmentId/$threadId"
                            params={{ environmentId: environmentId!, threadId: latestRun.threadId }}
                          >
                            <Clock3Icon className="size-3.5 text-muted-foreground" />
                            <span>{runStatusLabel(latestRun)}</span>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">No runs yet</span>
                        )}
                        {latestRun ? (
                          <div className="mt-1 text-muted-foreground">
                            {dateLabel(latestRun.scheduledFor)}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex items-center justify-end gap-1">
                        <Switch
                          aria-label={automation.enabled ? "Pause automation" : "Resume automation"}
                          checked={automation.enabled}
                          disabled={workingId === automation.id}
                          onCheckedChange={() => toggle(automation)}
                        />
                        <Button
                          aria-label="Run automation now"
                          disabled={workingId === automation.id || environmentId === null}
                          onClick={() =>
                            environmentId &&
                            void mutate(automation.id, () =>
                              runNow({ environmentId, input: { id: automation.id } }),
                            )
                          }
                          size="icon-sm"
                          variant="ghost"
                        >
                          <PlayIcon />
                        </Button>
                        <Menu>
                          <MenuTrigger
                            render={
                              <Button
                                aria-label="Automation actions"
                                size="icon-sm"
                                variant="ghost"
                              />
                            }
                          >
                            <MoreHorizontalIcon />
                          </MenuTrigger>
                          <MenuPopup align="end">
                            <MenuItem onClick={() => toggle(automation)}>
                              <CirclePauseIcon /> {automation.enabled ? "Pause" : "Resume"}
                            </MenuItem>
                            <MenuItem
                              variant="destructive"
                              onClick={() =>
                                environmentId &&
                                void mutate(automation.id, () =>
                                  removeAutomation({ environmentId, input: { id: automation.id } }),
                                )
                              }
                            >
                              <Trash2Icon /> Delete
                            </MenuItem>
                          </MenuPopup>
                        </Menu>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-80 flex-col items-center justify-center text-center">
                <div className="mb-3 grid size-10 place-items-center rounded-xl bg-muted">
                  <AlarmClockIcon className="size-5 text-muted-foreground" />
                </div>
                <h2 className="text-sm font-medium">No automations on this machine</h2>
                <Button
                  className="mt-4"
                  onClick={() => setDialogOpen(true)}
                  size="sm"
                  variant="outline"
                >
                  <PlusIcon /> New automation
                </Button>
              </div>
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogPopup className="w-full sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New automation</DialogTitle>
          </DialogHeader>
          <DialogPanel className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="automation-name">Name</Label>
              <Input
                id="automation-name"
                placeholder="Daily project check"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="automation-prompt">Instructions</Label>
              <Textarea
                id="automation-prompt"
                placeholder="Review the project and summarize anything that needs attention."
                rows={5}
                value={form.prompt}
                onChange={(event) => setForm({ ...form, prompt: event.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Workspace</Label>
                <Select
                  value={form.projectId}
                  onValueChange={(projectId) => projectId && setForm({ ...form, projectId })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={MACHINE_PROJECT}>Machine workspace</SelectItem>
                    {environmentProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Model</Label>
                <Select
                  value={form.modelKey}
                  onValueChange={(modelKey) => modelKey && setForm({ ...form, modelKey })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {models.map((model) => (
                      <SelectItem key={model.key} value={model.key}>
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Schedule</Label>
                <Select
                  value={form.scheduleKind}
                  onValueChange={(scheduleKind) =>
                    setForm({ ...form, scheduleKind: scheduleKind as AutomationSchedule["kind"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="hourly">Every hour</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekdays">Weekdays</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectPopup>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>{form.scheduleKind === "hourly" ? "Minute" : "Time"}</Label>
                {form.scheduleKind === "hourly" ? (
                  <Input
                    max={59}
                    min={0}
                    type="number"
                    value={form.minute}
                    onChange={(event) => setForm({ ...form, minute: event.target.value })}
                  />
                ) : (
                  <Input
                    type="time"
                    value={form.time}
                    onChange={(event) => setForm({ ...form, time: event.target.value })}
                  />
                )}
              </div>
            </div>
            {form.scheduleKind === "weekly" ? (
              <div className="grid gap-1.5">
                <Label>Day</Label>
                <Select
                  value={form.weekday}
                  onValueChange={(weekday) =>
                    setForm({ ...form, weekday: weekday as AutomationFormState["weekday"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {(["monday", "tuesday", "wednesday", "thursday", "friday"] as const).map(
                      (day) => (
                        <SelectItem key={day} value={day}>
                          {day.charAt(0).toUpperCase() + day.slice(1)}
                        </SelectItem>
                      ),
                    )}
                  </SelectPopup>
                </Select>
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label>Permissions</Label>
              <Select
                value={form.runtimeMode}
                onValueChange={(runtimeMode) =>
                  setForm({ ...form, runtimeMode: runtimeMode as RuntimeMode })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="full-access">Full access</SelectItem>
                  <SelectItem value="auto-accept-edits">Auto-accept edits</SelectItem>
                  <SelectItem value="approval-required">Ask for approval</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <DialogClose
              disabled={
                workingId === "create" ||
                form.name.trim() === "" ||
                form.prompt.trim() === "" ||
                form.modelKey === ""
              }
              render={
                <Button
                  disabled={
                    workingId === "create" ||
                    form.name.trim() === "" ||
                    form.prompt.trim() === "" ||
                    form.modelKey === ""
                  }
                  onClick={() => void submit()}
                />
              }
            >
              <AlarmClockIcon /> Schedule
            </DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </SidebarInset>
  );
}
