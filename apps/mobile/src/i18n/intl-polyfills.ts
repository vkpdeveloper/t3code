// GT validates every locale with Intl.Locale and English Intl.DisplayNames, and selects every plural
// branch with Intl.PluralRules; Hermes has none of them, so plural messages would render as raw ICU.
// gt-react-native's Babel plugin would inject these; plain imports keep the Metro and Babel config unchanged.
import "@formatjs/intl-getcanonicallocales/polyfill";
import "@formatjs/intl-locale/polyfill";
import "@formatjs/intl-displaynames/polyfill";
import "@formatjs/intl-displaynames/locale-data/en";
import "@formatjs/intl-pluralrules/polyfill";
import "@formatjs/intl-pluralrules/locale-data/en";
import "@formatjs/intl-pluralrules/locale-data/de";
import "@formatjs/intl-pluralrules/locale-data/es";
import "@formatjs/intl-pluralrules/locale-data/fr";
import "@formatjs/intl-pluralrules/locale-data/ja";
import "@formatjs/intl-pluralrules/locale-data/ko";
import "@formatjs/intl-pluralrules/locale-data/pt";
import "@formatjs/intl-pluralrules/locale-data/ru";
import "@formatjs/intl-pluralrules/locale-data/sv";
import "@formatjs/intl-pluralrules/locale-data/zh";
import { Platform } from "react-native";

// Hermes on Android builds a fresh collator across JNI for every localeCompare, so sorting a few
// hundred labels took a quarter second; one shared collator compares the same way ~17x faster.
if (Platform.OS === "android") {
  const collator = new Intl.Collator();
  const localeCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = function (
    this: string,
    that: string,
    locales?: Intl.LocalesArgument,
    options?: Intl.CollatorOptions,
  ) {
    return locales === undefined && options === undefined
      ? collator.compare(this, that)
      : localeCompare.call(this, that, locales, options);
  };

  // Date's locale methods pay the same per-call cost (~25x a shared formatter), so they reuse one
  // formatter per locale and options. Defaults follow ECMA-402 ToDateTimeOptions.
  const dateFields = ["weekday", "year", "month", "day"] as const;
  const timeFields = ["dayPeriod", "hour", "minute", "second", "fractionalSecondDigits"] as const;
  const formatters = new Map<string, Intl.DateTimeFormat>();
  const cachedDateMethod = (
    native: (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) => string,
    required: "any" | "date" | "time",
    defaults: "all" | "date" | "time",
  ) =>
    function (this: Date, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
      // Native keeps the spec's TypeError for a time style on a date-only method (and the
      // reverse), its own text for an invalid date, and inherited options the spread would drop.
      if (
        (options != null && Object.getPrototypeOf(options) !== Object.prototype) ||
        (required === "date" && options?.timeStyle !== undefined) ||
        (required === "time" && options?.dateStyle !== undefined) ||
        Number.isNaN(this.getTime())
      )
        return native.call(this, locales, options);
      // Intl.Locale objects stringify to their tags; JSON would collapse them all to {}. Without an
      // explicit zone the key carries the local offset, a cheap native read, so a device zone change
      // gets a new formatter; reading the zone's name would mean building a formatter per call.
      const key = JSON.stringify([
        required,
        defaults,
        typeof locales === "object" ? [locales].flat().map(String) : locales,
        options,
        options?.timeZone === undefined ? this.getTimezoneOffset() : null,
      ]);
      let formatter = formatters.get(key);
      if (!formatter) {
        const has = (fields: ReadonlyArray<keyof Intl.DateTimeFormatOptions>) =>
          fields.some((field) => options?.[field] !== undefined);
        const needsDefaults =
          options?.dateStyle === undefined &&
          options?.timeStyle === undefined &&
          !(required !== "time" && has(dateFields)) &&
          !(required !== "date" && has(timeFields));
        formatter = new Intl.DateTimeFormat(locales, {
          ...options,
          ...(needsDefaults && defaults !== "time"
            ? { year: "numeric", month: "numeric", day: "numeric" }
            : {}),
          ...(needsDefaults && defaults !== "date"
            ? { hour: "numeric", minute: "numeric", second: "numeric" }
            : {}),
        });
        formatters.set(key, formatter);
      }
      return formatter.format(this);
    };
  Date.prototype.toLocaleString = cachedDateMethod(Date.prototype.toLocaleString, "any", "all");
  Date.prototype.toLocaleDateString = cachedDateMethod(
    Date.prototype.toLocaleDateString,
    "date",
    "date",
  );
  Date.prototype.toLocaleTimeString = cachedDateMethod(
    Date.prototype.toLocaleTimeString,
    "time",
    "time",
  );
}
