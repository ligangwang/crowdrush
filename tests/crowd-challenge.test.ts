import assert from "node:assert/strict";
import test from "node:test";
import {
  beyond,
  challengeFor,
  readChallenge,
  readRules,
  writeRules,
} from "../src/crowd-challenge";
import { NO_PERKS } from "../src/crowd-core";

const lent = { perks: { squad: 3, power: 2, rate: 10 }, tries: 1 };

test("rules are written compactly and read back", () => {
  assert.equal(writeRules(lent), "s3p2r10.t1");
  assert.deepEqual(readRules(writeRules(lent)), lent);
  assert.match(writeRules(lent), /^[A-Za-z0-9._-]{1,64}$/);
  for (const bad of [
    "s11p0r0.t0",
    "s0p0r0.t6",
    "s0p0r0",
    "p0s0r0.t0",
    "",
    undefined,
  ])
    assert.equal(readRules(bad), null, String(bad));
});

test("a challenge made from a level reads back as that level", () => {
  const round = { level: 12, score: 4210, rules: lent };
  assert.deepEqual(challengeFor(round), {
    mode: "level",
    seed: "12",
    score: 4210,
    unit: "points",
    rules: "s3p2r10.t1",
  });
  assert.deepEqual(readChallenge(challengeFor(round)), round);
});

test("other games' challenges and malformed ones are ignored", () => {
  const ok = {
    mode: "level",
    seed: "3",
    score: 10,
    unit: "points" as const,
    rules: "s0p0r0.t0",
  };
  assert.ok(readChallenge(ok));
  for (const bad of [
    null,
    { ...ok, mode: "daily" },
    { ...ok, unit: "digits" as const },
    { ...ok, seed: "0" },
    { ...ok, seed: "12345" },
    { ...ok, seed: undefined },
    { ...ok, score: -1 },
    { ...ok, score: 1.5 },
    { ...ok, rules: undefined },
  ])
    assert.equal(readChallenge(bad), null, JSON.stringify(bad));
});

test("rules give more than the player has with a higher tier or eased tries", () => {
  const own = { squad: 3, power: 2, rate: 10 };
  assert.equal(beyond({ perks: own, tries: 0 }, own), false);
  assert.equal(beyond({ perks: NO_PERKS, tries: 0 }, own), false);
  assert.equal(beyond({ perks: own, tries: 1 }, own), true);
  assert.equal(beyond({ perks: { ...own, power: 3 }, tries: 0 }, own), true);
});
