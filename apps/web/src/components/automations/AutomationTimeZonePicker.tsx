import { ChevronDownIcon } from "lucide-react";
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
} from "../ui/combobox";

function timeZoneLabel(timeZone: string, date: Date): string {
  try {
    const offset =
      new Intl.DateTimeFormat("en", {
        timeZone,
        timeZoneName: "longOffset",
      })
        .formatToParts(date)
        .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
    return `${timeZone} (${offset.replace("GMT", "UTC")})`;
  } catch {
    return timeZone;
  }
}

export function AutomationTimeZonePicker(props: {
  readonly value: string;
  readonly onChange: (timeZone: string) => void;
}) {
  const [query, setQuery] = useState("");
  const items = useMemo(() => {
    const now = new Date();
    return [...new Set([props.value, "UTC", "Asia/Kolkata", ...Intl.supportedValuesOf("timeZone")])]
      .filter((zone) => zone !== "Asia/Calcutta")
      .sort()
      .map((value) => ({ value, label: timeZoneLabel(value, now) }));
  }, [props.value]);
  const selected = items.find((item) => item.value === props.value) ?? null;
  return (
    <Combobox
      autoHighlight
      items={items}
      filteredItems={items.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))}
      value={selected}
      isItemEqualToValue={(left, right) => left.value === right.value}
      itemToStringLabel={(item) => item.label}
      onValueChange={(item) => {
        if (item) props.onChange(item.value);
      }}
      onOpenChange={() => setQuery("")}
    >
      <ComboboxTrigger
        render={
          <Button
            aria-label="Choose time zone"
            className="h-10 w-full min-w-0 justify-between px-3 font-normal"
            variant="outline"
          />
        }
      >
        <span className="truncate">{selected?.label ?? props.value}</span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </ComboboxTrigger>
      <ComboboxPopup className="w-80 max-w-[calc(100vw-2rem)]">
        <ComboboxInput
          aria-label="Search time zones"
          placeholder="Search time zones or offsets..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          showTrigger={false}
        />
        <ComboboxEmpty>No time zones found.</ComboboxEmpty>
        <ComboboxList>
          {(item: (typeof items)[number]) => (
            <ComboboxItem key={item.value} value={item}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
