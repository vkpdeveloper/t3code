import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { ChevronDownIcon, FolderIcon, FolderPlusIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
  useComboboxFilter,
} from "../ui/combobox";

export const MACHINE_PROJECT = "__machine__";

interface ProjectOption {
  readonly value: string;
  readonly label: string;
  readonly detail: string;
  readonly project: EnvironmentProject | null;
}

export function AutomationProjectPicker(props: {
  readonly environmentLabel: string;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onAddProject: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filter = useComboboxFilter();
  const items = useMemo<ReadonlyArray<ProjectOption>>(
    () => [
      {
        value: MACHINE_PROJECT,
        label: "No project",
        detail: `Use the ${props.environmentLabel} machine workspace`,
        project: null,
      },
      ...[...props.projects]
        .sort((left, right) => left.title.localeCompare(right.title))
        .map((project) => ({
          value: project.id,
          label: project.title,
          detail: project.workspaceRoot,
          project,
        })),
    ],
    [props.environmentLabel, props.projects],
  );
  const selectedItem = items.find((item) => item.value === props.value) ?? {
    value: props.value,
    label: "Unavailable project",
    detail: "Choose a project or the machine workspace",
    project: null,
  };
  const filteredItems = useMemo(
    () =>
      query.trim() === ""
        ? items
        : items.filter((item) =>
            filter.contains(item, query, (candidate) => `${candidate.label} ${candidate.detail}`),
          ),
    [filter, items, query],
  );

  return (
    <Combobox
      autoHighlight
      filteredItems={filteredItems}
      isItemEqualToValue={(left, right) => left.value === right.value}
      itemToStringLabel={(item) => item.label}
      items={items}
      open={open}
      value={selectedItem}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
      onValueChange={(item) => {
        if (item) props.onChange(item.value);
      }}
    >
      <ComboboxTrigger
        render={
          <Button
            aria-label="Choose project"
            className="h-10 w-full min-w-0 justify-start px-3 font-normal"
            type="button"
            variant="outline"
          />
        }
      >
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-start">{selectedItem.label}</span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </ComboboxTrigger>
      <ComboboxPopup className="w-(--anchor-width) min-w-72 overflow-hidden">
        <div className="shrink-0 px-3 pt-2.5">
          <div className="relative border-b border-border/70 pb-1.5 focus-within:border-ring">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1.5 left-0 size-4 text-muted-foreground/55"
            />
            <ComboboxInput
              aria-label="Search projects"
              className="[&_input]:h-6.5 [&_input]:ps-5 [&_input]:font-sans [&_input]:leading-6.5"
              inputClassName="rounded-none bg-transparent text-sm"
              placeholder="Search projects..."
              showTrigger={false}
              size="sm"
              unstyled
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <ComboboxEmpty>No matching projects.</ComboboxEmpty>
        <ComboboxList className="max-h-64">
          {(item: ProjectOption) => (
            <ComboboxItem
              className="min-h-11 py-1.5"
              contentClassName="flex min-w-0 items-center gap-2"
              hideIndicator
              key={item.value}
              value={item}
            >
              <FolderIcon className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
        <div className="border-t p-1">
          <Button
            aria-label="Add project for automation"
            className="w-full justify-start"
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              props.onAddProject();
            }}
          >
            <FolderPlusIcon /> Add project
          </Button>
        </div>
      </ComboboxPopup>
    </Combobox>
  );
}
