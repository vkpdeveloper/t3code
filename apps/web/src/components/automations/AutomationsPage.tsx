import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_SERVER_SETTINGS,
  type Automation,
  type AutomationSchedule,
  type EnvironmentId,
  type ProviderInstanceId,
  ProjectId,
  type RuntimeMode,
} from "@t3tools/contracts";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  AlarmClockIcon,
  CirclePauseIcon,
  HistoryIcon,
  FolderPlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";

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
import { AutomationRunHistoryDialog } from "./AutomationRunHistoryDialog";
import {
  automationFormFromAutomation,
  automationInputFromForm,
  defaultAutomationForm,
  type AutomationFormState,
} from "./automationForm";
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
  const search = useSearch({ from: "/automations" });
  const navigate = useNavigate({ from: "/automations" });
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const clientSettings = useClientSettings();
  const environmentId =
    search.environmentId ?? primaryEnvironmentId ?? environments[0]?.environmentId ?? null;
  const [editor, setEditor] = useState<{
    environmentId: EnvironmentId;
    automation: Automation | null;
  } | null>(null);
  const editingAutomation = editor?.automation ?? null;
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
  const [form, setForm] = useState(() =>
    defaultAutomationForm(null, Intl.DateTimeFormat().resolvedOptions().timeZone),
  );
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
  const openEditor = (automation: Automation | null) => {
    if (environmentId === null) return;
    setEditor({ environmentId, automation });
    setForm(
      automation
        ? automationFormFromAutomation(automation)
        : defaultAutomationForm(
            defaultModelSelection,
            Intl.DateTimeFormat().resolvedOptions().timeZone,
          ),
    );
    setAddingProject(false);
    setNewProjectPath("");
    setError(null);
  };

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
    if (environmentId === null || editor?.environmentId !== environmentId) return;
    const input = automationInputFromForm(form);
    if (input === null) {
      setError("Name, instructions, and a model are required.");
      return;
    }
    try {
      Intl.DateTimeFormat(undefined, { timeZone: input.schedule.timeZone });
    } catch {
      setError("Enter a valid time zone, such as Asia/Kolkata or America/New_York.");
      return;
    }
    const succeeded = editingAutomation
      ? await mutate(editingAutomation.id, () =>
          updateAutomation({ environmentId, input: { id: editingAutomation.id, ...input } }),
        )
      : await mutate("create", () => createAutomation({ environmentId, input }));
    if (succeeded) {
      setAddingProject(false);
      setNewProjectPath("");
      setEditor(null);
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
          onValueChange={(value) =>
            void navigate({ search: { environmentId: value as EnvironmentId } })
          }
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
          onClick={() => openEditor(null)}
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
            {error || query.error ? (
              <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error ?? query.error}
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
                          <Link
                            to="/automations"
                            search={{ environmentId: environmentId!, automationId: automation.id }}
                            className="truncate rounded text-sm font-medium outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {automation.name}
                          </Link>
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
                        <Link
                          className="inline-flex items-center gap-1.5 rounded outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                          to="/automations"
                          search={{ environmentId: environmentId!, automationId: automation.id }}
                          aria-label={`View run history for ${automation.name}`}
                        >
                          <HistoryIcon className="size-3.5 text-muted-foreground" />
                          <span>Run history ({automation.runs.length})</span>
                        </Link>
                        {latestRun ? (
                          <div className="mt-1 text-muted-foreground">
                            Latest: {dateLabel(latestRun.scheduledFor)}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          aria-label={`Edit ${automation.name}`}
                          disabled={workingId === automation.id}
                          onClick={() => openEditor(automation)}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <PencilIcon />
                        </Button>
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
                            <MenuItem
                              disabled={workingId === automation.id}
                              onClick={() => openEditor(automation)}
                            >
                              <PencilIcon /> Edit
                            </MenuItem>
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
            ) : query.error ? null : (
              <div className="flex min-h-80 flex-col items-center justify-center text-center">
                <div className="mb-3 grid size-10 place-items-center rounded-xl bg-muted">
                  <AlarmClockIcon className="size-5 text-muted-foreground" />
                </div>
                <h2 className="text-sm font-medium">No automations on this machine</h2>
                <Button
                  className="mt-4"
                  disabled={environmentId === null || defaultModelSelection === null}
                  onClick={() => openEditor(null)}
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

      {environmentId && search.automationId ? (
        <AutomationRunHistoryDialog
          key={`${environmentId}:${search.automationId}`}
          environmentId={environmentId}
          automationId={search.automationId}
          onClose={() => void navigate({ search: { environmentId } })}
        />
      ) : null}

      <Dialog
        open={editor !== null && editor.environmentId === environmentId}
        onOpenChange={(open) => {
          if (!open) {
            setEditor(null);
            setAddingProject(false);
            setNewProjectPath("");
            setError(null);
          }
        }}
      >
        <DialogPopup className="w-full sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingAutomation ? "Edit automation" : "New automation"}</DialogTitle>
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
                  value={form.projectId ?? MACHINE_PROJECT}
                  onAddProject={() => {
                    setError(null);
                    setAddingProject(true);
                  }}
                  onChange={(projectId) =>
                    setForm({
                      ...form,
                      projectId: projectId === MACHINE_PROJECT ? null : ProjectId.make(projectId),
                    })
                  }
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
                        modelSelection:
                          form.modelSelection?.instanceId === instanceId &&
                          form.modelSelection.model === model
                            ? form.modelSelection
                            : { instanceId, model },
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
                    {(
                      [
                        "monday",
                        "tuesday",
                        "wednesday",
                        "thursday",
                        "friday",
                        "saturday",
                        "sunday",
                      ] as const
                    ).map((day) => (
                      <SelectItem key={day} value={day}>
                        {day.charAt(0).toUpperCase() + day.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="automation-time-zone">Time zone</Label>
              <Input
                id="automation-time-zone"
                value={form.timeZone}
                placeholder="Asia/Kolkata"
                onChange={(event) => setForm({ ...form, timeZone: event.target.value })}
              />
            </div>
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
                  <SelectItem value="auto">Automatic</SelectItem>
                  <SelectItem value="full-access">Full access</SelectItem>
                  <SelectItem value="auto-accept-edits">Auto-accept edits</SelectItem>
                  <SelectItem value="approval-required">Ask for approval</SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="automation-enabled">Enabled</Label>
              <Switch
                id="automation-enabled"
                checked={form.enabled}
                onCheckedChange={(enabled) => setForm({ ...form, enabled })}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button
              disabled={
                workingId !== null ||
                form.name.trim() === "" ||
                form.prompt.trim() === "" ||
                form.modelSelection === null ||
                form.timeZone.trim() === ""
              }
              onClick={() => void submit()}
            >
              {editingAutomation ? (
                "Save changes"
              ) : (
                <>
                  <AlarmClockIcon /> Schedule
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </SidebarInset>
  );
}
