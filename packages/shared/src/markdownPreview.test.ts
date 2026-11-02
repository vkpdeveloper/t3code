import { describe, expect, it } from "vite-plus/test";

import { markdownPreviewText } from "./markdownPreview.ts";

describe("markdownPreviewText", () => {
  it("keeps the text a renderer would show on one line", () => {
    expect(
      markdownPreviewText(
        "# Trip\nSaved to [trip.md](/Users/me/trip.md):\n- **Found**  three\n> `flights`, _soon_.",
      ),
    ).toBe("Trip Saved to trip.md: Found three flights, soon.");
  });
});
