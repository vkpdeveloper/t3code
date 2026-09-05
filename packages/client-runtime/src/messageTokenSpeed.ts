import type { OrchestrationMessage } from "@t3tools/contracts";

/** Estimate reply delivery speed from persisted server timestamps, independent of provider usage. */
export function messageTokenSpeed(
  message: Pick<OrchestrationMessage, "role" | "text" | "streaming" | "createdAt" | "updatedAt">,
) {
  if (message.role !== "assistant" || message.streaming || !message.text.trim()) {
    return null;
  }

  const durationMs = Date.parse(message.updatedAt) - Date.parse(message.createdAt);
  // Buffered replies can arrive in one event or a very short burst. Their
  // timestamps cannot give a useful estimate of generation speed.
  if (!Number.isFinite(durationMs) || durationMs < 1_000) {
    return {
      label: "Speed unavailable",
      description:
        "This reply has less than one second of recorded delivery time or no usable timing. Buffered replies cannot provide a reliable speed estimate.",
    };
  }

  let characters = 0;
  for (const _character of message.text) characters += 1;
  const tokensPerSecond = characters / 4 / (durationMs / 1_000);
  const rate = tokensPerSecond < 0.1 ? "<0.1" : tokensPerSecond.toFixed(1);

  return {
    label: `≈${rate} tok/s`,
    description:
      "Estimated final reply delivery speed, using roughly 4 characters per token from first recorded text to reply completion. Tokenization varies by model and language. Excludes earlier thinking and tool work; provider buffering and connection delays affect the rate.",
  };
}
