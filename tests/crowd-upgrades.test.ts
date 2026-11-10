import assert from "node:assert/strict";
import test from "node:test";
import {
  buyUpgrade,
  loadPerks,
  nextUpgrade,
  perksFrom,
} from "../src/crowd-upgrades";
import { CRIT_PERK, newLevel, shotRate, start, step } from "../src/crowd-core";
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
  assert.deepEqual(perks, { power: 2, rate: 0 });
  assert.deepEqual(nextUpgrade("power", perks), {
    id: "power-3",
    tier: 3,
    price: 250,
  });
  assert.deepEqual(nextUpgrade("rate", perks), {
    id: "rate-1",
    tier: 1,
    price: 50,
  });
  assert.equal(nextUpgrade("power", { power: 3, rate: 0 }), null);
});

test("prices and tiers match game.json's shop", () => {
  for (const kind of ["power", "rate"] as const)
    for (let tier = 1; tier <= 3; tier++) {
      const next = nextUpgrade(kind, { power: tier - 1, rate: tier - 1 })!;
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
  });
  assert.deepEqual(await loadPerks(sdk(async () => ({}), false)), {
    power: 0,
    rate: 0,
  });
});

test("upgrades fire faster and land critical hits", () => {
  const w = newLevel(3);
  const base = shotRate(w);
  w.perks = { power: 0, rate: 3 };
  assert.ok(Math.abs(shotRate(w) / base - 1.3) < 1e-9);
  // about 45% of shots crit with 3 power tiers
  w.perks = { power: 3, rate: 0 };
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
  assert.ok(Math.abs(share - CRIT_PERK * 3) < 0.12, `${crits}/${shots}`);
});
