import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { BOSSES } from "../src/crowd-core";
import { packs, translate } from "../src/i18n";

const game = JSON.parse(readFileSync("game.json", "utf8")) as {
  languages: string[];
  title: Record<string, string>;
  description: Record<string, string>;
};
const zh = packs["zh-CN"];
const placeholders = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort();
const hasHan = (s: string) => /\p{Script=Han}/u.test(s);

test("every language pack has the Chinese pack's keys and placeholders", () => {
  const files = readdirSync("src/locales")
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
  assert.deepEqual(files, Object.keys(packs).sort());
  for (const [lang, pack] of Object.entries(packs)) {
    assert.deepEqual(Object.keys(pack).sort(), Object.keys(zh).sort(), lang);
    for (const [key, value] of Object.entries(pack)) {
      assert.ok(value.trim(), `${lang}: "${key}" is empty`);
      assert.deepEqual(
        placeholders(value),
        placeholders(key),
        `${lang}: "${key}" → "${value}"`,
      );
    }
  }
});

test("game.json lists English plus every pack, with a title and description in each", () => {
  assert.deepEqual(
    [...game.languages].sort(),
    ["en", ...Object.keys(packs)].sort(),
  );
  // dingn calls Chinese's title and description field "zh"
  for (const lang of game.languages) {
    const field = lang === "zh-CN" ? "zh" : lang;
    assert.ok(game.title[field]?.trim(), `title.${field}`);
    assert.ok(game.description[field]?.trim(), `description.${field}`);
  }
});

test("each language gets its own text, patterns included", () => {
  const cases: Record<string, [string, string, string]> = {
    "zh-CN": ["开始", "第 7 关", "朋友拿了 1,234 分，你能超过吗？"],
    es: [
      "Empezar",
      "Nivel 7",
      "Un amigo hizo 1,234 puntos. ¿Puedes superarlo?",
    ],
    "pt-BR": [
      "Começar",
      "Fase 7",
      "Um amigo fez 1,234 pontos. Você consegue superar?",
    ],
    id: [
      "Mulai",
      "Level 7",
      "Temanmu dapat 1,234 poin. Bisakah kamu mengalahkannya?",
    ],
    ja: [
      "スタート",
      "レベル 7",
      "友だちは1,234ポイントでした。超えられるかな？",
    ],
    ko: ["시작", "레벨 7", "친구가 1,234점을 냈어요. 이길 수 있나요?"],
  };
  for (const [lang, [start, level, friend]] of Object.entries(cases)) {
    assert.equal(translate("Start", lang), start, lang);
    assert.equal(translate("Level 7", lang), level, lang);
    assert.equal(
      translate("A friend scored 1,234 points. Can you beat it?", lang),
      friend,
      lang,
    );
  }
  // the longest literal wins: "Level {0} of {1}" over "Level {0}"
  assert.equal(translate("Level 2 of 10", "es"), "Nivel 2 de 10");
  assert.equal(
    translate("Your score to beat: 900. 12 more to beat it.", "ko"),
    "넘어야 할 점수: 900점. 12점만 더 따면 이겨요.",
  );
});

test("English, unknown languages and missing text stay English, never Chinese", () => {
  for (const locale of ["en", "fr", "de", "zh", "constructor", "toString"]) {
    assert.equal(translate("Start", locale), "Start", locale);
    assert.equal(translate("Level 3", locale), "Level 3", locale);
    assert.equal(translate("POWER", locale), "POWER", locale);
  }
  for (const lang of Object.keys(packs))
    assert.equal(translate("Not a game string", lang), "Not a game string");
  // no pack but Chinese's hands out Chinese text
  for (const [lang, pack] of Object.entries(packs)) {
    if (lang === "zh-CN") continue;
    for (const key of Object.keys(pack)) {
      const text = translate(key, lang);
      assert.notEqual(text, zh[key], `${lang}: ${key}`);
      // Japanese writes kanji too; every other pack has none
      if (lang !== "ja") assert.ok(!hasHan(text), `${lang}: ${key}`);
    }
  }
});

test("every boss name is translated", () => {
  for (const [lang, pack] of Object.entries(packs))
    for (const b of BOSSES) assert.ok(pack[b.name], `${lang}: ${b.name}`);
});
