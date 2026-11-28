import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

const native = {
  localeCompare: String.prototype.localeCompare,
  toLocaleString: Date.prototype.toLocaleString,
  toLocaleDateString: Date.prototype.toLocaleDateString,
  toLocaleTimeString: Date.prototype.toLocaleTimeString,
};
const timeZone = process.env.TZ;

describe("Android Date locale formatter cache", () => {
  beforeAll(async () => {
    await import("./intl-polyfills");
  });
  afterAll(() => {
    String.prototype.localeCompare = native.localeCompare;
    Date.prototype.toLocaleString = native.toLocaleString;
    Date.prototype.toLocaleDateString = native.toLocaleDateString;
    Date.prototype.toLocaleTimeString = native.toLocaleTimeString;
    process.env.TZ = timeZone;
  });

  it("keeps different Intl.Locale objects apart", () => {
    const date = new Date(Date.UTC(2026, 0, 31, 12));
    const options = { month: "long", timeZone: "UTC" } as const;
    expect(date.toLocaleDateString(new Intl.Locale("en-US"), options)).toBe("January");
    expect(date.toLocaleDateString(new Intl.Locale("de-DE"), options)).toBe("Januar");
  });

  it("reads inherited options", () => {
    const date = new Date(Date.UTC(2026, 0, 31, 9));
    const options = Object.create({ hour: "2-digit", timeZone: "UTC" });
    expect(date.toLocaleString("en-US", options)).toBe("09 AM");
  });

  it("follows a device time zone change", () => {
    const date = new Date(Date.UTC(2026, 0, 31, 12));
    process.env.TZ = "UTC";
    const utc = date.toLocaleTimeString("en-US");
    process.env.TZ = "Asia/Kolkata";
    expect(date.toLocaleTimeString("en-US")).not.toBe(utc);
    expect(date.toLocaleTimeString("en-US")).toBe(native.toLocaleTimeString.call(date, "en-US"));
  });
});
