import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import {
  BOT_AVATAR_COLORS,
  BOT_AVATAR_SHAPES,
  BOT_NAME_MAX_LENGTH,
  type BotAvatarColor,
  type BotAvatarShape,
  type ProjectBot,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { formatModelSlugName } from "@t3tools/shared/model";
import { useNavigate } from "@tanstack/react-router";
import { FileIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { useRightPanelStore } from "../../rightPanelStore";
import { useEnvironmentProviders } from "../../state/environments";
import { useThreadShell } from "../../state/entities";
import { useEnvironmentPresentation } from "../../state/presentation";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { getDisplayModelName } from "../chat/providerIconUtils";
import { ThreadAutomationsPanel } from "../chat/ThreadAutomationsPanel";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { toastManager } from "../ui/toast";
import { BotAvatar } from "./BotAvatar";
import { BotAvatarPicker } from "./BotAvatarPicker";

type BotTab = "details" | "artifacts" | "computer";

function reportFailure(title: string, result: Parameters<typeof squashAtomCommandFailure>[0]) {
  const error = squashAtomCommandFailure(result);
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : "An error occurred.",
  });
}

function knownShape(value: string): BotAvatarShape {
  return BOT_AVATAR_SHAPES.find((shape) => shape === value) ?? "circle";
}

function knownColor(value: string): BotAvatarColor {
  return BOT_AVATAR_COLORS.find((color) => color === value) ?? "gray";
}

function AvatarEditor({
  project,
  bot,
  threadRef,
}: {
  project: EnvironmentProject;
  bot: ProjectBot;
  threadRef: ScopedThreadRef;
}) {
  const updateBot = useOrchestrationCommand(serverEnvironment.updateBot, { reportFailure: false });
  const generateAvatar = useOrchestrationCommand(serverEnvironment.generateBotAvatar, {
    reportFailure: false,
  });
  const providers = useEnvironmentProviders().get(project.environmentId) ?? EMPTY_SERVER_PROVIDERS;
  const canGenerate = providers.some(
    (provider) => provider.driver === "codex" && provider.enabled && provider.installed,
  );
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const shape = knownShape(bot.avatar.shape);
  const color = knownColor(bot.avatar.color);
  const imagePath = bot.avatar.imagePath ?? null;

  const saveAvatar = async (next: {
    shape: BotAvatarShape;
    color: BotAvatarColor;
    imagePath?: null;
  }) => {
    const result = await updateBot({
      environmentId: project.environmentId,
      input: { projectId: project.id, avatar: next },
    });
    if (result._tag === "Failure") reportFailure("Could not update avatar", result);
  };

  const generate = async () => {
    setGenerating(true);
    const trimmed = prompt.trim();
    const result = await generateAvatar({
      environmentId: project.environmentId,
      input: { projectId: project.id, ...(trimmed ? { prompt: trimmed } : {}) },
    });
    setGenerating(false);
    if (result._tag === "Failure") reportFailure("Could not generate avatar", result);
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Change avatar"
            className="cursor-pointer rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          />
        }
      >
        <BotAvatar avatar={bot.avatar} threadRef={threadRef} className="size-14" />
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="start" className="w-72">
        <div className="flex flex-col gap-3">
          <BotAvatarPicker
            shape={shape}
            color={color}
            disabled={generating}
            onChange={(next) => void saveAvatar(next)}
          />
          {canGenerate ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                void generate();
              }}
            >
              <Input
                size="sm"
                aria-label="Avatar idea"
                placeholder={`Avatar for ${project.title}`}
                value={prompt}
                maxLength={500}
                disabled={generating}
                onChange={(event) => setPrompt(event.target.value)}
              />
              <Button type="submit" size="sm" variant="outline" disabled={generating}>
                <SparklesIcon />
                {generating ? "Generating" : "Generate"}
              </Button>
            </form>
          ) : null}
          {imagePath !== null ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={generating}
              onClick={() => void saveAvatar({ shape, color, imagePath: null })}
            >
              Use shape instead
            </Button>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function BotName({ project }: { project: EnvironmentProject }) {
  const updateBot = useOrchestrationCommand(serverEnvironment.updateBot, { reportFailure: false });
  const [draft, setDraft] = useState<string | null>(null);
  const commit = async () => {
    const name = draft?.trim() ?? "";
    setDraft(null);
    if (name.length === 0 || name === project.title) return;
    const result = await updateBot({
      environmentId: project.environmentId,
      input: { projectId: project.id, name },
    });
    if (result._tag === "Failure") reportFailure("Could not rename bot", result);
  };
  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(project.title)}
        className="min-w-0 cursor-text truncate rounded-md text-left text-base font-semibold outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {project.title}
      </button>
    );
  }
  return (
    <Input
      size="sm"
      autoFocus
      aria-label="Bot name"
      maxLength={BOT_NAME_MAX_LENGTH}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(null);
      }}
    />
  );
}

function BotModel({ threadRef }: { threadRef: ScopedThreadRef }) {
  const shell = useThreadShell(threadRef);
  const providers =
    useEnvironmentProviders().get(threadRef.environmentId) ?? EMPTY_SERVER_PROVIDERS;
  if (shell === null) return null;
  const { instanceId, model } = shell.modelSelection;
  const provider = providers.find((entry) => entry.instanceId === instanceId);
  const known = provider?.models.find((entry) => entry.slug === model);
  return (
    <p className="truncate px-2.5 text-sm text-foreground">
      {known ? getDisplayModelName(known) : formatModelSlugName(model)}
      {provider?.displayName ? (
        <span className="text-muted-foreground"> on {provider.displayName}</span>
      ) : null}
    </p>
  );
}

function BotArtifacts({
  project,
  threadRef,
}: {
  project: EnvironmentProject;
  threadRef: ScopedThreadRef;
}) {
  const query = useEnvironmentQuery(
    projectEnvironment.listEntries({
      environmentId: project.environmentId,
      input: { cwd: project.workspaceRoot, directoryPath: "artifacts" },
    }),
  );
  const files = (query.data?.entries ?? [])
    .filter((entry) => entry.kind === "file")
    .toSorted((left, right) => left.path.localeCompare(right.path));
  if (files.length === 0) {
    return (
      <p className="px-2.5 py-2 text-sm text-muted-foreground">
        {query.isPending && query.data === null ? "Loading" : "No artifacts yet"}
      </p>
    );
  }
  return (
    <ul className="flex flex-col">
      {files.map((file) => (
        <li key={file.path}>
          <button
            type="button"
            onClick={() => useRightPanelStore.getState().openFile(threadRef, file.path)}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm outline-hidden hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <FileIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{file.path.replace(/^artifacts\//, "")}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function BotComputer({ project }: { project: EnvironmentProject }) {
  const navigate = useNavigate();
  const { presentation } = useEnvironmentPresentation(project.environmentId);
  const deleteBot = useOrchestrationCommand(serverEnvironment.deleteBot, { reportFailure: false });
  const remove = async () => {
    const confirmed =
      (await requestConfirmDialog(
        `Delete ${project.title}?\nIts chat and routines stop. Files in its folder stay on disk.`,
        { variant: "destructive" },
      )) ?? window.confirm(`Delete ${project.title}?`);
    if (!confirmed) return;
    const result = await deleteBot({
      environmentId: project.environmentId,
      input: { projectId: project.id },
    });
    if (result._tag === "Failure") {
      reportFailure("Could not delete bot", result);
      return;
    }
    void navigate({ to: "/" });
  };
  const rows: Array<[string, string]> = [
    ["Computer", presentation?.entry.target.label ?? "Unknown"],
    ["Status", presentation?.connection.phase === "connected" ? "Connected" : "Offline"],
    ["Folder", project.workspaceRoot],
  ];
  return (
    <div className="flex flex-col gap-3 px-2.5 py-1">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-all">{value}</dd>
          </div>
        ))}
      </dl>
      <Button size="sm" variant="destructive-outline" className="self-start" onClick={remove}>
        <Trash2Icon />
        Delete bot
      </Button>
    </div>
  );
}

/** The right panel for a bot's session: who it is, what it made, and where it runs. */
export function BotDetails({
  project,
  bot,
  threadRef,
}: {
  project: EnvironmentProject;
  bot: ProjectBot;
  threadRef: ScopedThreadRef;
}) {
  const [tab, setTab] = useState<BotTab>("details");
  return (
    <>
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <AvatarEditor project={project} bot={bot} threadRef={threadRef} />
        <div className="flex min-w-0 flex-1 flex-col">
          <BotName project={project} />
        </div>
      </div>
      <div className="px-4 pb-2">
        <ToggleGroup
          aria-label="Bot details"
          className="w-full *:flex-1"
          value={[tab]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "details" || value === "artifacts" || value === "computer") setTab(value);
          }}
        >
          <Toggle value="details">Details</Toggle>
          <Toggle value="artifacts">Artifacts</Toggle>
          <Toggle value="computer">Computer</Toggle>
        </ToggleGroup>
      </div>
      {tab === "details" ? (
        <>
          <ThreadDetailsSection headingId="bot-description-heading" title="Description">
            <p className="px-2.5 text-sm whitespace-pre-wrap text-foreground">
              {bot.description ?? (
                <span className="text-muted-foreground">Written after your first chat</span>
              )}
            </p>
          </ThreadDetailsSection>
          <ThreadDetailsSection headingId="bot-model-heading" title="Model">
            <BotModel threadRef={threadRef} />
          </ThreadDetailsSection>
          <ThreadAutomationsPanel
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            title="Routines"
            emptyText="No routines yet"
          />
        </>
      ) : tab === "artifacts" ? (
        <ThreadDetailsSection
          headingId="bot-artifacts-heading"
          title="Artifacts"
          showHeading={false}
        >
          <BotArtifacts project={project} threadRef={threadRef} />
        </ThreadDetailsSection>
      ) : (
        <ThreadDetailsSection headingId="bot-computer-heading" title="Computer" showHeading={false}>
          <BotComputer project={project} />
        </ThreadDetailsSection>
      )}
    </>
  );
}
