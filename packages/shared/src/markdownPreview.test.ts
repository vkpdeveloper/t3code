import { describe, expect, it } from "vite-plus/test";

import { markdownPreviewText } from "./markdownPreview.ts";

describe("markdownPreviewText", () => {
  it.each([
    [
      "# Trip\nSaved to [trip.md](/Users/me/trip.md):\n- **Found**  three\n> `flights`, _soon_.",
      "Trip Saved to trip.md: Found three flights, soon.",
    ],
    [
      "Run `__init__.py` on `src/*/index.*` and **ship**",
      "Run __init__.py on src/*/index.* and ship",
    ],
    ["See [docs](https://example.com/a_(b)) now", "See docs now"],
    ["Read [API [v2]](https://example.com/docs)", "Read API [v2]"],
    ["Keep snake_case_name and 2 * 3 * 4", "Keep snake_case_name and 2 * 3 * 4"],
  ])("shows %j as the rendered text", (markdown, text) => {
    expect(markdownPreviewText(markdown)).toBe(text);
  });
});
