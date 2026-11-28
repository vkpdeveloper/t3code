import { View } from "react-native";

import { cn } from "../../lib/cn";

// Material's radio, drawn with views: a Compose RadioButton needs a Compose host per row, and
// mounting hundreds of those made long pickers stutter while scrolling.
/** The enclosing radio row owns selection, touch and accessibility. */
export function RadioIndicator({ selected }: { readonly selected: boolean }) {
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      className="size-6 items-center justify-center"
    >
      <View
        className={cn(
          "size-5 items-center justify-center rounded-full border-2",
          selected ? "border-primary-text" : "border-foreground-muted",
        )}
      >
        {selected ? <View className="size-2.5 rounded-full bg-primary-text" /> : null}
      </View>
    </View>
  );
}
