import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FIRST_WIN,
  LEVEL_MILESTONES,
  THREE_STARS,
  badgesFor,
  createBadgeTracker,
  levelBadge,
  tierFor,
} from "../src/crowd-badges";

const manifest = JSON.parse(readFileSync("game.json", "utf8"));

test("game.json declares every badge the game awards, in the right tier", () => {
  const declared = new Map(
    manifest.badges.map((b: { id: string; tier: string }) => [b.id, b.tier]),
  );
  for (const level of LEVEL_MILESTONES)
    assert.equal(declared.get(levelBadge(level)), tierFor(level), `${level}`);
  assert.ok(declared.has(FIRST_WIN));
  assert.ok(declared.has(THREE_STARS));
  assert.equal(declared.size, LEVEL_MILESTONES.length + 2);
  // dingn pays bronze 10, silver 25, gold 50, diamond 100, up to 1,000 a game.
  const pays = { bronze: 10, silver: 25, gold: 50, diamond: 100 } as const;
  const total = manifest.badges.reduce(
    (sum: number, b: { tier: keyof typeof pays }) => sum + pays[b.tier],
    0,
  );
  assert.ok(total <= 1000, `${total}`);
});

test("a cleared level earns its milestones and anything missed before", () => {
  assert.deepEqual(badgesFor(3, 2), [FIRST_WIN]);
  assert.deepEqual(badgesFor(12, 3), [
    FIRST_WIN,
    THREE_STARS,
    "level-5",
    "level-10",
  ]);
  assert.equal(badgesFor(250, 1).length, 21);
});

test("only badges the player doesn't have yet are unlocked", async () => {
  const sent: string[] = [];
  const sdk = {
    player: { signedIn: true, name: "Ada", avatar: "" },
    rewards: {
      unlock: async (id: string) => {
        sent.push(id);
        return { new: true, coins: 10 };
      },
      list: async () => [
        {
          id: FIRST_WIN,
          tier: "bronze" as const,
          coins: 10,
          title: "",
          earned: true,
        },
      ],
    },
  };
  const tracker = createBadgeTracker();
  assert.deepEqual(await tracker.cleared(sdk, 10, 1), ["level-5", "level-10"]);
  assert.deepEqual(await tracker.cleared(sdk, 11, 3), [THREE_STARS]);
  assert.deepEqual(sent, ["level-5", "level-10", THREE_STARS]);
  assert.deepEqual(
    await tracker.cleared({ ...sdk, player: { ...sdk.player, signedIn: false } }, 20, 3),
    [],
  );
});

test("a failed unlock stops quietly and is retried next win", async () => {
  let fail = true;
  const sent: string[] = [];
  const sdk = {
    player: { signedIn: true, name: "Ada", avatar: "" },
    rewards: {
      unlock: async (id: string) => {
        if (fail) throw Object.assign(new Error("x"), { code: "unavailable" });
        sent.push(id);
        return { new: true, coins: 10 };
      },
      list: async () => [],
    },
  };
  const tracker = createBadgeTracker();
  assert.deepEqual(await tracker.cleared(sdk, 5, 1), []);
  fail = false;
  assert.deepEqual(await tracker.cleared(sdk, 5, 1), [FIRST_WIN, "level-5"]);
});
