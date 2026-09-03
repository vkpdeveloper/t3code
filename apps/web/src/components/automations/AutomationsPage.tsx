import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_SERVER_SETTINGS,
  type Automation,
  type AutomationCreateInput,
  type AutomationSchedule,
  type EnvironmentId,
  type ModelSelection,
  type ProviderInstanceId,
  type ProjectId,
  type RuntimeMode,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  AlarmClockIcon,
  CirclePauseIcon,
  Clock3Icon,
  FolderPlusIcon,
  MoreHorizontalIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { isElectron } from "../../env";
import { mergeEnvironmentSettings, useClientSettings } from "../../hooks/useSettings";
import { findProjectByPath, inferProjectTitleFromPath } from "../../lib/projectPaths";
import { newProjectId } from "../../lib/utils";
import { getAppModelOptionsForInstance, resolveAppModelSelectionState } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { automationEnvironment, useAutomations } from "../../state/automations";
import { useProjects, waitForProject } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { AutomationProjectPicker, MACHINE_PROJECT } from "./AutomationProjectPicker";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
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
  readonly modelSelection: ModelSelection | null;
  readonly runtimeMode: RuntimeMode;
}

function defaultForm(modelSelection: ModelSelection | null): AutomationFormState {
  return {
    name: "",
    prompt: "",
    projectId: MACHINE_PROJECT,
    scheduleKind: "daily",
    time: "09:00",
    minute: "0",
    weekday: "monday",
    modelSelection,
    runtimeMode: "full-access",
  };
}

function scheduleKindLabel(kind: AutomationSchedule["kind"]): string {
  switch (kind) {
    case "hourly":
      return "Every hour";
    case "daily":
      return "Daily";
    case "weekdays":
      return "Weekdays";
    case "weekly":
      return "Weekly";
  }
}

function runtimeModeLabel(mode: RuntimeMode): string {
  switch (mode) {
    case "auto":
      return "Automatic";
    case "full-access":
      return "Full access";
    case "auto-accept-edits":
      return "Auto-accept edits";
    case "approval-required":
      return "Ask for approval";
  }
}

export function AutomationsPage() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const clientSettings = useClientSettings();
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(
    primaryEnvironmentId ?? environments[0]?.environmentId ?? null,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  const [newProjectPath, setNewProjectPath] = useState("");
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useAutomations(environmentId);
  const createAutomation = useAtomCommand(automationEnvironment.create);
  const createProject = useAtomCommand(projectEnvironment.create);
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
  const providerStatuses = selectedEnvironment?.serverConfig?.providers ?? [];
  const settings = useMemo(
    () =>
      mergeEnvironmentSettings(
        selectedEnvironment?.serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS,
        clientSettings,
      ),
    [clientSettings, selectedEnvironment?.serverConfig?.settings],
  );
  const providerInstanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providerStatuses), settings),
      ),
    [providerStatuses, settings],
  );
  const defaultModelSelection = useMemo(
    () =>
      providerStatuses.length > 0
        ? resolveAppModelSelectionState(settings, providerStatuses)
        : null,
    [providerStatuses, settings],
  );
  const [form, setForm] = useState<AutomationFormState>(() => defaultForm(null));
  const modelOptionsByInstance = useMemo(() => {
    const options = new Map<ProviderInstanceId, ReturnType<typeof getAppModelOptionsForInstance>>();
    for (const entry of providerInstanceEntries) {
      options.set(
        entry.instanceId,
        getAppModelOptionsForInstance(
          settings,
          entry,
          entry.instanceId === form.modelSelection?.instanceId ? form.modelSelection.model : null,
        ),
      );
    }
    return options;
  }, [form.modelSelection, providerInstanceEntries, settings]);
  useEffect(() => {
    const selectedEntry = providerInstanceEntries.find(
      (entry) => entry.instanceId === form.modelSelection?.instanceId,
    );
    const selectionExists =
      selectedEntry?.enabled === true &&
      selectedEntry.isAvailable &&
      modelOptionsByInstance
        .get(selectedEntry.instanceId)
        ?.some((option) => option.slug === form.modelSelection?.model);
    if (!selectionExists) {
      setForm((current) =>
        current.modelSelection === null && defaultModelSelection === null
          ? current
          : { ...current, modelSelection: defaultModelSelection },
      );
    }
  }, [defaultModelSelection, form.modelSelection, modelOptionsByInstance, providerInstanceEntries]);

  useEffect(() => {
    if (
      form.projectId !== MACHINE_PROJECT &&
      !environmentProjects.some((project) => project.id === form.projectId)
    ) {
      setForm((current) => ({ ...current, projectId: MACHINE_PROJECT }));
    }
  }, [environmentProjects, form.projectId]);

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
    if (form.modelSelection === null || form.name.trim() === "" || form.prompt.trim() === "") {
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
      modelSelection: form.modelSelection,
      runtimeMode: form.runtimeMode,
      enabled: true,
    };
    const succeeded = await mutate("create", () => createAutomation({ environmentId, input }));
    if (succeeded) {
      setForm(defaultForm(defaultModelSelection));
      setAddingProject(false);
      setNewProjectPath("");
      setDialogOpen(false);
    }
  };

  const registerProject = async () => {
    if (environmentId === null) return;
    const workspaceRoot = newProjectPath.trim();
    if (workspaceRoot === "") {
      setError("Enter a folder path for the project.");
      return;
    }
    const existingProject = findProjectByPath(environmentProjects, workspaceRoot);
    if (existingProject) {
      setForm((current) => ({ ...current, projectId: existingProject.id }));
      setAddingProject(false);
      setNewProjectPath("");
      return;
    }

    const projectId = newProjectId();
    const succeeded = await mutate("project:create", () =>
      createProject({
        environmentId,
        input: {
          projectId,
          title: inferProjectTitleFromPath(workspaceRoot),
          workspaceRoot,
          createWorkspaceRootIfMissing: true,
          defaultModelSelection: null,
        },
      }),
    );
    if (!succeeded) return;

    try {
      await waitForProject(scopeProjectRef(environmentId, projectId));
      setForm((current) => ({ ...current, projectId }));
      setAddingProject(false);
      setNewProjectPath("");
    } catch (cause) {
      setError(messageFromUnknown(cause));
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
          disabled={environmentId === null || defaultModelSelection === null}
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
                            params={{
                              environmentId: environmentId!,
                              threadId: latestRun.threadId,
                            }}
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
                              runNow({
                                environmentId,
                                input: { id: automation.id },
                              }),
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
                                  removeAutomation({
                                    environmentId,
                                    input: { id: automation.id },
                                  }),
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

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setAddingProject(false);
            setNewProjectPath("");
            setError(null);
          }
        }}
      >
        <DialogPopup className="w-full sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New automation</DialogTitle>
          </DialogHeader>
          <DialogPanel className="grid gap-4">
            {error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}
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
                <Label>Project</Label>
                <AutomationProjectPicker
                  environmentLabel={selectedEnvironment?.label ?? "this"}
                  projects={environmentProjects}
                  value={form.projectId}
                  onAddProject={() => {
                    setError(null);
                    setAddingProject(true);
                  }}
                  onChange={(projectId) => setForm({ ...form, projectId })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Model</Label>
                {form.modelSelection ? (
                  <ProviderModelPicker
                    activeInstanceId={form.modelSelection.instanceId}
                    instanceEntries={providerInstanceEntries}
                    lockedProvider={null}
                    model={form.modelSelection.model}
                    modelOptionsByInstance={modelOptionsByInstance}
                    triggerAriaLabel="Choose model"
                    triggerClassName="h-10 w-full max-w-none px-3"
                    triggerVariant="outline"
                    onInstanceModelChange={(instanceId, model) =>
                      setForm({
                        ...form,
                        modelSelection: { instanceId, model },
                      })
                    }
                  />
                ) : (
                  <Button className="h-10 w-full justify-start" disabled variant="outline">
                    No model available
                  </Button>
                )}
              </div>
            </div>
            {addingProject ? (
              <div className="grid gap-2 rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">
                    Add project to {selectedEnvironment?.label ?? "machine"}
                  </span>
                  <Button
                    aria-label="Cancel adding project"
                    size="xs"
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setAddingProject(false);
                      setNewProjectPath("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
                <Label htmlFor="automation-project-path">Folder path</Label>
                <div className="flex gap-2">
                  <Input
                    autoFocus
                    id="automation-project-path"
                    placeholder="/path/to/project"
                    value={newProjectPath}
                    onChange={(event) => setNewProjectPath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void registerProject();
                      }
                    }}
                  />
                  <Button
                    disabled={workingId === "project:create" || newProjectPath.trim() === ""}
                    type="button"
                    variant="outline"
                    onClick={() => void registerProject()}
                  >
                    <FolderPlusIcon /> Add
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Schedule</Label>
                <Select
                  value={form.scheduleKind}
                  onValueChange={(scheduleKind) =>
                    setForm({
                      ...form,
                      scheduleKind: scheduleKind as AutomationSchedule["kind"],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue>{scheduleKindLabel(form.scheduleKind)}</SelectValue>
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
                    setForm({
                      ...form,
                      weekday: weekday as AutomationFormState["weekday"],
                    })
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
                  <SelectValue>{runtimeModeLabel(form.runtimeMode)}</SelectValue>
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
            <Button
              disabled={
                workingId === "create" ||
                form.name.trim() === "" ||
                form.prompt.trim() === "" ||
                form.modelSelection === null
              }
              onClick={() => void submit()}
            >
              <AlarmClockIcon /> Schedule
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </SidebarInset>
  );
}
