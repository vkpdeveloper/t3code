export function inferDefaultVariant(
  providerID: string,
  variants: ReadonlyArray<string>,
): string | undefined {
  if (variants.length === 1) {
    return variants[0];
  }
  if (providerID === "anthropic" || providerID.startsWith("google")) {
    return variants.includes("high") ? "high" : undefined;
  }
  if (providerID === "openai" || providerID === "opencode") {
    return variants.includes("medium") ? "medium" : variants.includes("high") ? "high" : undefined;
  }
  if (providerID === "opencode-go") {
    return ["max", "high", "medium"].find((variant) => variants.includes(variant)) ?? variants[0];
  }
  return undefined;
}

export function resolveModelVariant(
  providerID: string,
  variants: ReadonlyArray<string> | undefined,
  selected: string | undefined,
): string | undefined {
  // Custom or unavailable models have no authoritative list to validate against.
  if (variants === undefined) return selected;
  if (selected !== undefined && variants.includes(selected)) return selected;
  return inferDefaultVariant(providerID, variants);
}
