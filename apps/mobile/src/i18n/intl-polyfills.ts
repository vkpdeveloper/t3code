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
}
