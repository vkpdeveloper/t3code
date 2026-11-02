import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  BOT_NAME_MAX_LENGTH,
  CommandId,
  type BotAvatarColor,
  type BotAvatarShape,
  type EnvironmentId,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import { useAtomSet } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useId, useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import {
  getCustomModelOptionsByInstance,
  resolveEffectiveDefaultModelSelection,
} from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { sidebarModeAtom } from "../../state/bots";
import {
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { isConnectedWithConfig } from "../settings/scopedSettings";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { BotAvatarShape as BotAvatarShapeGlyph } from "./BotAvatar";
import { BotAvatarPicker } from "./BotAvatarPicker";

// Settings hooks need an id; with no computer connected nothing is created anyway.
const NO_ENVIRONMENT = "" as EnvironmentId;

export function CreateBotDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        {open ? <CreateBotForm onDone={() => onOpenChange(false)} /> : null}
      </DialogPopup>
    </Dialog>
  );
}

function defaultBotModel(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection | null {
  const stored = resolveDefaultProviderModelSelection(providers, settings.defaultModelSelection);
  return stored ? resolveEffectiveDefaultModelSelection(settings, providers, stored) : null;
}

type AvatarChoice = { shape: BotAvatarShape; color: BotAvatarColor };

function CreateBotForm({ onDone }: { onDone: () => void }) {
  const { environments } = useEnvironments();
  const machines = environments.filter(isConnectedWithConfig);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<AvatarChoice>({ shape: "circle", color: "teal" });
  const [chosenEnvironmentId, setChosenEnvironmentId] = useState<EnvironmentId | null>(null);
  const environmentId =
    machines.find((machine) => machine.environmentId === chosenEnvironmentId)?.environmentId ??
    machines.find((machine) => machine.environmentId === primaryEnvironmentId)?.environmentId ??
    machines[0]?.environmentId ??
    null;
  const machinePicker =
    machines.length === 0 ? (
      <p className="text-sm text-muted-foreground">No connected computers</p>
    ) : (
      <Select
        value={environmentId ?? ""}
        onValueChange={(value) => setChosenEnvironmentId(value as EnvironmentId)}
        items={machines.map((machine) => ({ value: machine.environmentId, label: machine.label }))}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {machines.map((machine) => (
            <SelectItem key={machine.environmentId} value={machine.environmentId}>
              {machine.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    );
  return (
    <MachineBotForm
      // Each computer has its own providers, so its model choice starts fresh.
      key={environmentId ?? "none"}
      environmentId={environmentId}
      name={name}
      onNameChange={setName}
      avatar={avatar}
      onAvatarChange={setAvatar}
      machinePicker={machinePicker}
      onDone={onDone}
    />
  );
}

function MachineBotForm({
  environmentId,
  name,
  onNameChange,
  avatar,
  onAvatarChange,
  machinePicker,
  onDone,
}: {
  environmentId: EnvironmentId | null;
  name: string;
  onNameChange: (name: string) => void;
  avatar: AvatarChoice;
  onAvatarChange: (avatar: AvatarChoice) => void;
  machinePicker: ReactNode;
  onDone: () => void;
}) {
  const id = useId();
  const navigate = useNavigate();
  const setSidebarMode = useAtomSet(sidebarModeAtom);
  const createBot = useOrchestrationCommand(serverEnvironment.createBot, { reportFailure: false });
  const settings = useEnvironmentSettings(environmentId ?? NO_ENVIRONMENT);
  const providersByEnvironment = useEnvironmentProviders();
  const providers =
    (environmentId ? providersByEnvironment.get(environmentId) : undefined) ??
    EMPTY_SERVER_PROVIDERS;
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings, null),
  );
  const [chosenModel, setChosenModel] = useState<ModelSelection | null>(null);
  const model =
    chosenModel &&
    entries.some((entry) => entry.instanceId === chosenModel.instanceId && entry.enabled)
      ? chosenModel
      : defaultBotModel(settings, providers);
  const activeEntry = entries.find((entry) => entry.instanceId === model?.instanceId);
  // One command id per attempt, so a retry after a lost reply returns the same bot.
  const [commandId, setCommandId] = useState(() => CommandId.make(randomUUID()));
  const [pending, setPending] = useState(false);
  const trimmedName = name.trim();

  const submit = async () => {
    if (pending || environmentId === null || model === null || trimmedName.length === 0) return;
    setPending(true);
    const result = await createBot({
      environmentId,
      input: { commandId, name: trimmedName, avatar, modelSelection: model },
    });
    setPending(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not create bot",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
      return;
    }
    setCommandId(CommandId.make(randomUUID()));
    setSidebarMode("bots");
    onDone();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams({ environmentId, threadId: result.value.threadId }),
    });
  };

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>New bot</DialogTitle>
      </DialogHeader>
      <DialogPanel>
        <fieldset disabled={pending} className="flex flex-col gap-5">
          <div className="flex justify-center">
            <span className="flex size-20 items-center justify-center rounded-full bg-muted">
              <BotAvatarShapeGlyph shape={avatar.shape} color={avatar.color} className="size-14" />
            </span>
          </div>
          <BotAvatarPicker shape={avatar.shape} color={avatar.color} onChange={onAvatarChange} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input
              id={`${id}-name`}
              autoFocus
              maxLength={BOT_NAME_MAX_LENGTH}
              placeholder="Scout"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Computer</Label>
            {machinePicker}
          </div>
          {environmentId !== null ? (
            <div className="flex flex-col gap-1.5">
              <Label>Model</Label>
              {model === null ? (
                <p className="text-sm text-muted-foreground">No providers on this computer</p>
              ) : (
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <ProviderModelPicker
                    environmentId={environmentId}
                    disabled={pending}
                    activeInstanceId={model.instanceId}
                    model={model.model}
                    lockedProvider={null}
                    instanceEntries={entries}
                    modelOptionsByInstance={getCustomModelOptionsByInstance(
                      settings,
                      providers,
                      model.instanceId,
                      model.model,
                    )}
                    isComposerOwned={false}
                    onInstanceModelChange={(instanceId, slug) =>
                      setChosenModel(createModelSelection(instanceId, slug))
                    }
                  />
                  {activeEntry ? (
                    <TraitsPicker
                      provider={activeEntry.driverKind}
                      models={activeEntry.models}
                      model={model.model}
                      modelOptions={model.options ?? []}
                      allowPromptInjectedEffort={false}
                      planModeEnabled={settings.planModeEnabled}
                      disabled={pending}
                      onModelOptionsChange={(options) =>
                        setChosenModel(createModelSelection(model.instanceId, model.model, options))
                      }
                    />
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </fieldset>
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={pending || environmentId === null || model === null || trimmedName.length === 0}
        >
          {pending ? "Creating" : "Create"}
        </Button>
      </DialogFooter>
    </form>
  );
}
