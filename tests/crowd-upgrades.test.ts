import assert from "node:assert/strict";
import test from "node:test";
import {
  buyUpgrade,
  loadPerks,
  nextUpgrade,
  perksFrom,
} from "../src/crowd-upgrades";
import {
  applyPerks,
  critChance,
  MAX_TIER,
  TIER_UNLOCK,
  newLevel,
  shotRate,
  start,
  startCount,
  step,
} from "../src/crowd-core";
import game from "../game.json" with { type: "json" };

const item = (id: string, owned: boolean) => ({
  id,
  price: 1,
  title: id,
  owned,
});

test("owned tiers count in order, and the next tier is offered", () => {
  const perks = perksFrom([
    item("power-1", true),
    item("power-2", true),
    item("power-3", false),
    item("rate-1", false),
    item("rate-2", true), // can't own tier 2 without tier 1: ignored
  ]);
  assert.deepEqual(perks, { power: 2, rate: 0, squad: 0 });
  assert.deepEqual(nextUpgrade("power", perks), {
    id: "power-3",
    tier: 3,
    price: 250,
    unlocks: null,
  });
  assert.deepEqual(nextUpgrade("rate", perks), {
    id: "rate-1",
    tier: 1,
    price: 50,
    unlocks: null,
  });
  assert.equal(nextUpgrade("power", { power: 10, rate: 0, squad: 0 }), null);
});

test("prices and tiers match game.json's shop", () => {
  for (const kind of ["squad", "power", "rate"] as const)
    for (let tier = 1; tier <= MAX_TIER; tier++) {
      const next = nextUpgrade(kind, {
        power: tier - 1,
        rate: tier - 1,
        squad: tier - 1,
      })!;
      const listed = game.shop.find((i) => i.id === next.id)!;
      assert.equal(listed.price, next.price);
      assert.equal(
        (listed as { requires?: string }).requires,
        tier > 1 ? `${kind}-${tier - 1}` : undefined,
      );
    }
});

test("buying reports what happened, and signed-out players own nothing", async () => {
  const fail = (code: string) => async () => {
    throw Object.assign(new Error(code), { code });
  };
  const sdk = (spend: () => Promise<unknown>, signedIn = true) => ({
    player: { signedIn, name: "", avatar: "" },
    rewards: {
      spend: spend as never,
      shop: async () => [item("rate-1", true)],
    },
  });
  assert.equal(
    await buyUpgrade(
      sdk(async () => ({ new: true, coins: 50 })),
      "power-1",
    ),
    "bought",
  );
  assert.equal(
    await buyUpgrade(sdk(fail("cancelled")), "power-1"),
    "cancelled",
  );
  assert.equal(
    await buyUpgrade(sdk(fail("not_enough_coins")), "power-1"),
    "poor",
  );
  assert.deepEqual(await loadPerks(sdk(async () => ({}))), {
    power: 0,
    rate: 1,
    squad: 0,
  });
  assert.deepEqual(await loadPerks(sdk(async () => ({}), false)), {
    power: 0,
    rate: 0,
    squad: 0,
  });
});

test("upgrades fire faster and land critical hits", () => {
  const w = newLevel(3);
  const base = shotRate(w);
  w.perks = { power: 0, rate: 3, squad: 0 };
  assert.ok(Math.abs(shotRate(w) / base - 1.3) < 1e-9);
  // about 45% of shots crit with 3 power tiers
  w.perks = { power: 3, rate: 0, squad: 0 };
  w.things = []; // an empty road, so the squad just keeps shooting
  start(w);
  let shots = 0;
  let crits = 0;
  for (let i = 0; i < 600 && w.phase === "run"; i++) {
    step(w, 1 / 60);
    for (const b of w.bullets)
      if (!(b as { seen?: boolean }).seen) {
        (b as { seen?: boolean }).seen = true;
        shots++;
        if (b.dmg > w.power) crits++;
      }
  }
  const share = crits / shots;
  assert.ok(Math.abs(share - critChance(3)) < 0.12, `${crits}/${shots}`);
});

test("the squad upgrade starts each level with more soldiers", () => {
  const counts = [0, 1, 2, 3].map((squad) =>
    startCount({ power: 0, rate: 0, squad }),
  );
  assert.deepEqual(counts, [1, 4, 7, 11]);
  assert.deepEqual(
    perksFrom([item("squad-1", true), item("squad-2", true)]).squad,
    2,
  );
  const w = newLevel(4);
  applyPerks(w, { power: 0, rate: 0, squad: 3 });
  assert.equal(w.count, 11);
  assert.equal(w.best, 11);
  // a level already under way keeps its squad
  start(w);
  w.count = 30;
  applyPerks(w, { power: 0, rate: 0, squad: 1 });
  assert.equal(w.count, 30);
});

test("levels are partly sized for the upgrades the player owns", () => {
  const max = { power: 3, rate: 3, squad: 3 };
  for (const lv of [2, 12, 30]) {
    const plain = newLevel(lv);
    const upgraded = newLevel(lv, max);
    // same track (gates, crates, walls), tougher enemies and boss
    const track = (w: typeof plain) =>
      w.things.filter((t) => t.kind !== "monster").map((t) => t.z);
    assert.deepEqual(track(upgraded), track(plain));
    const hp = (w: typeof plain) =>
      w.things.reduce((s, t) => s + (t.kind === "monster" ? t.maxHp : 0), 0);
    assert.ok(hp(upgraded) > hp(plain), `monsters on level ${lv}`);
    assert.ok(upgraded.boss.maxHp > plain.boss.maxHp, `boss on ${lv}`);
    assert.deepEqual(upgraded.perks, max);
  }
});

test("tiers past the third unlock as the player goes deeper", () => {
  const owned = { power: 3, rate: 3, squad: 3 };
  assert.equal(nextUpgrade("power", owned, 19)!.unlocks, 20);
  assert.equal(nextUpgrade("power", owned, 20)!.unlocks, null);
  assert.equal(nextUpgrade("rate", { ...owned, rate: 9 }, 109)!.unlocks, 110);
  assert.equal(TIER_UNLOCK.length, MAX_TIER);
  // every price fits dingn's limit, and the shop fits its 30 items
  assert.ok(game.shop.length <= 30);
  for (const item of game.shop)
    assert.ok(item.price >= 1 && item.price <= 1000);
  // critical hits reach every shot at the top tier, never more
  assert.equal(critChance(MAX_TIER), 1);
});
