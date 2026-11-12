import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useMemo } from "react";

import { buildModelOptions, groupByProvider } from "../../lib/modelOptions";
import { resolveProviderOptionDescriptors } from "../../lib/providerOptions";
import { ThreadSettingsPickerScreen } from "../threads/ThreadSettingsSheet";
import { updateBotDraft } from "./bot-draft";
import { useBotDraftModel } from "./NewBotRouteScreen";

export function BotModelPickerRouteScreen({
  route,
}: StaticScreenProps<{ readonly environmentId: EnvironmentId }>) {
  const navigation = useNavigation();
  const { environmentId } = route.params;
  const { config, selection } = useBotDraftModel(environmentId);
  const models = useMemo(
    () => buildModelOptions(config, selection, undefined, null),
    [config, selection],
  );
  const providerGroups = useMemo(() => groupByProvider(models), [models]);
  const selectedOption = models.find(
    (option) =>
      option.selection.instanceId === selection?.instanceId &&
      option.selection.model === selection.model,
  );
  const optionDescriptors = useMemo(
    () =>
      resolveProviderOptionDescriptors({
        capabilities: selectedOption?.capabilities,
        selections: selection?.options,
      }),
    [selectedOption?.capabilities, selection?.options],
  );

  return (
    <ThreadSettingsPickerScreen
      environmentId={environmentId}
      projectId={null}
      cwd={null}
      providerGroups={providerGroups}
      selectedModel={selection}
      prompt=""
      onPromptChange={() => undefined}
      onSelectModel={(option) => updateBotDraft({ modelSelection: option.selection })}
      optionDescriptors={optionDescriptors}
      onUpdateOptionSelections={(options) => {
        if (selection) updateBotDraft({ modelSelection: { ...selection, options } });
      }}
      onClose={() => navigation.goBack()}
    />
  );
}
