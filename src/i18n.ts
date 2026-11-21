// Crowd Rush in every language it lists in game.json. English is the source:
// each pack in locales/ maps the English text to its translation, with the
// same rules as the website's: exact strings first, then patterns such as
// "Level {0}", longest literal first.
import type { Locale } from "../sdk/dingn-sdk.js";
import es from "./locales/es.json";
import id from "./locales/id.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import ptBR from "./locales/pt-BR.json";
import zhCN from "./locales/zh-CN.json";

/** Every language pack, by dingn's language code. English has none. */
export const packs: Record<string, Record<string, string>> = {
  "zh-CN": zhCN,
  es,
  "pt-BR": ptBR,
  id,
  ja,
  ko,
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
type Pattern = { re: RegExp; value: string };
const compiled = new Map<string, Pattern[]>();
function patternsOf(locale: string): Pattern[] {
  let list = compiled.get(locale);
  if (!list) {
    list = Object.entries(packs[locale])
      .filter(([key]) => /\{\d+\}/.test(key))
      .sort(
        ([a], [b]) =>
          b.replace(/\{\d+\}/g, "").length - a.replace(/\{\d+\}/g, "").length,
      )
      .map(([key, value]) => ({
        re: new RegExp(
          "^" +
            key
              .split(/\{\d+\}/)
              .map(escape)
              .join("(.*?)") +
            "$",
        ),
        value,
      }));
    compiled.set(locale, list);
  }
  return list;
}

/**
 * The text in `locale`. English, a language without a pack, or text the pack
 * lacks give back the English text, never another language's.
 */
export function translate(text: string, locale: Locale): string {
  if (!text || !Object.hasOwn(packs, locale)) return text;
  const catalog = packs[locale];
  const key = text.replace(/\s+/g, " ").trim();
  if (Object.hasOwn(catalog, key) && catalog[key]) return catalog[key];
  for (const { re, value } of patternsOf(locale)) {
    const match = key.match(re);
    if (match)
      return value.replace(/\{(\d+)\}/g, (_, n) => match[Number(n) + 1] ?? "");
  }
  return text;
}
