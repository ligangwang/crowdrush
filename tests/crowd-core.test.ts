import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOp,
  BOSS_REACH,
  BOSS_STOP,
  crowdRadius,
  defeated,
  lossCoins,
  winCoins,
  levelCoins,
  heavyRounds,
  FULL_RATE_COUNT,
  firepower,
  volley,
  MAX_COUNT,
  MAX_COIN_PACKS,
  MIN_COIN_PACKS,
  MAX_PACK_COINS,
  MIN_PACK_COINS,
  newLevel,
  progress,
  RUN_SPEED,
  shotRate,
  START_COUNT,
  start,
  stars,
  steer,
  step,
  type World,
} from "../src/crowd-core";

/** A simple player: take the better gate, dodge walls, shoot what it can break. */
function autopilot(w: World) {
  // damage the squad can deal to something dist metres ahead before reaching it
  const canBreak = (hp: number, dist: number) =>
    hp <= shotRate(w) * w.power * (dist / RUN_SPEED) * 0.7;
  const ahead = w.things
    .filter(
      (t) =>
        t.z > w.z - 0.5 &&
        t.z - w.z < 22 &&
        t.kind !== "monster" &&
        !(t.kind === "gate" ? t.used : t.dead) &&
        !(t.kind === "block" && t.upgrade && !canBreak(t.hp, t.z - w.z)),
    )
    .sort((a, b) => a.z - b.z)[0];
  if (!ahead) return steer(w, 0);
  if (ahead.kind === "gate")
    return steer(
      w,
      applyOp(w.count, ahead.left) >= applyOp(w.count, ahead.right)
        ? -0.55
        : 0.55,
    );
  if (ahead.kind === "block") {
    const row = w.things.filter(
      (t) => t.kind === "block" && !t.dead && Math.abs(t.z - ahead.z) < 0.1,
    );
    if (ahead.upgrade) return steer(w, ahead.x);
    const crate = row.find(
      (t) => t.kind === "block" && t.reward && canBreak(t.hp, t.z - w.z),
    );
    if (crate && crate.kind === "block") return steer(w, crate.x);
    const lanes = [-0.62, 0, 0.62].filter(
      (x) => !row.some((t) => t.kind === "block" && t.x === x),
    );
    return steer(w, lanes[0] ?? 0);
  }
  return steer(w, ahead.kind === "squad" ? ahead.x : 0);
}
function play(level: number, pilot: (w: World) => void) {
  const w = newLevel(level);
  start(w);
  for (
    let i = 0;
    i < 20 * 60 * 4 && (w.phase === "run" || w.phase === "boss");
    i++
  ) {
    pilot(w);
    step(w, 1 / 60);
    w.events.length = 0;
  }
  return w;
}

test("levels are deterministic and open with a gate whose doors differ", () => {
  assert.deepEqual(
    JSON.stringify(newLevel(3).things),
    JSON.stringify(newLevel(3).things),
  );
  for (let lv = 1; lv <= 20; lv++) {
    const first = newLevel(lv).things[0];
    assert.equal(first.kind, "gate");
    if (first.kind === "gate")
      assert.notEqual(
        applyOp(START_COUNT, first.left),
        applyOp(START_COUNT, first.right),
      );
  }
});

test("gate maths never goes below zero or above the cap", () => {
  assert.equal(applyOp(10, { op: "+", n: 5 }), 15);
  assert.equal(applyOp(10, { op: "-", n: 50 }), 0);
  assert.equal(applyOp(10, { op: "x", n: 3 }), 30);
  assert.equal(applyOp(9, { op: "/", n: 2 }), 4);
  assert.equal(applyOp(600, { op: "x", n: 2 }), 999);
});

test("a sensible player clears the opening levels and most of the first twenty", () => {
  let wins = 0;
  for (let lv = 1; lv <= 20; lv++) {
    const w = play(lv, autopilot);
    if (lv <= 12)
      assert.equal(
        w.phase,
        "won",
        `level ${lv} ended ${w.phase} at ${progress(w)}`,
      );
    if (w.phase === "won") {
      wins++;
      assert.ok(stars(w) >= 1);
    }
  }
  assert.ok(wins >= 17, `won ${wins} of 20`);
});

test("levels 1 to 10 are eased in, and the easing is gone from level 11", () => {
  // the boss's summon interval before easing (hard = level + 3)
  const unsoftened = (lv: number) => Math.max(1.2, 2.6 - (lv + 3) * 0.06);
  let last = Infinity;
  for (let lv = 1; lv <= 12; lv++) {
    const ratio = newLevel(lv).boss.summonEvery / unsoftened(lv);
    if (lv <= 10) assert.ok(ratio > 1 && ratio < last, `level ${lv}: ${ratio}`);
    else assert.equal(ratio, 1);
    last = ratio;
  }
  // level 1 is about 30% gentler
  assert.ok(
    Math.abs(newLevel(1).boss.summonEvery / unsoftened(1) - 1 / 0.7) < 1e-9,
  );
});

test("difficulty keeps climbing with no last level", () => {
  const threat = (lv: number) => {
    const w = newLevel(lv);
    let hp = w.boss.maxHp;
    for (const t of w.things) if (t.kind === "monster") hp += t.maxHp;
    return {
      hp,
      monsters: w.things.filter((t) => t.kind === "monster").length,
    };
  };
  const sum = (from: number) => {
    let hp = 0;
    let monsters = 0;
    for (let lv = from; lv < from + 10; lv++) {
      const t = threat(lv);
      hp += t.hp;
      monsters += t.monsters;
    }
    return { hp, monsters };
  };
  const a = sum(1);
  const b = sum(21);
  const c = sum(91);
  assert.ok(b.hp > a.hp && c.hp > b.hp, `${a.hp} < ${b.hp} < ${c.hp}`);
  assert.ok(b.monsters > a.monsters, `${a.monsters} < ${b.monsters}`);
  // a sensible player struggles much more deep into the game
  let lateWins = 0;
  for (let lv = 31; lv <= 40; lv++)
    if (play(lv, autopilot).phase === "won") lateWins++;
  assert.ok(lateWins <= 5, `won ${lateWins} of levels 31-40`);
});

test("always taking the worse door leaves a much smaller squad", () => {
  let sensible = 0;
  let careless = 0;
  for (let lv = 1; lv <= 10; lv++) {
    sensible += play(lv, autopilot).best;
    const w = play(lv, (w) => {
      autopilot(w);
      const gate = w.things.find((t) => t.kind === "gate" && !t.used);
      if (gate && gate.kind === "gate" && gate.z - w.z < 22)
        steer(
          w,
          applyOp(w.count, gate.left) < applyOp(w.count, gate.right)
            ? -0.55
            : 0.55,
        );
    });
    careless += w.best;
  }
  assert.ok(careless < sensible * 0.5, `${careless} vs ${sensible}`);
});

test("a squad that never steers loses every one of the first fifteen levels", () => {
  for (let lv = 1; lv <= 15; lv++) {
    const w = play(lv, () => {});
    assert.equal(w.phase, "lost", `level ${lv} ended ${w.phase}`);
  }
});

test("monsters charge at the squad and the boss stomps toward it", () => {
  const w = newLevel(2);
  w.things = [];
  w.things.push({
    kind: "monster",
    id: 1,
    z: 30,
    x: 0.7,
    hp: 99,
    maxHp: 99,
    big: false,
    bite: 1,
    reward: 0,
    speed: 4.5,
    minion: false,
    dead: false,
  });
  start(w);
  w.speed = 0;
  for (let i = 0; i < 60; i++) step(w, 1 / 60);
  const m = w.things[0];
  assert.ok(m.kind === "monster" && m.z < 26 && m.x < 0.7, "monster homes in");

  const b = newLevel(2);
  b.things = [];
  b.count = 500;
  b.boss.hp = 99999;
  b.z = b.boss.z - BOSS_STOP;
  b.phase = "boss";
  const from = b.boss.z;
  for (let i = 0; i < 60 * 3; i++) step(b, 1 / 60);
  assert.ok(b.boss.z < from - 2, "boss walks toward the squad");
  for (let i = 0; i < 60 * 20; i++) step(b, 1 / 60);
  assert.ok(b.boss.z - b.z <= BOSS_REACH + 0.01, "boss reaches the squad");
});

test("steering is clamped to the road and the squad widens as it grows", () => {
  const w = newLevel(1);
  steer(w, 5);
  assert.ok(w.targetX < 1);
  assert.ok(crowdRadius(200) > crowdRadius(10));
  start(w);
  step(w, 0.5);
  assert.ok(w.z > 0 && w.x > 0);
  assert.ok(w.shotsFired > 0);
});

test("monsters roam every level, die to gunfire and bite on contact", () => {
  let withBrutes = 0;
  for (let lv = 1; lv <= 10; lv++) {
    const monsters = newLevel(lv).things.filter((t) => t.kind === "monster");
    assert.ok(monsters.length >= 8, `level ${lv} has ${monsters.length}`);
    if (monsters.some((m) => m.kind === "monster" && m.big)) withBrutes++;
  }
  assert.ok(withBrutes >= 7, `brutes in only ${withBrutes} levels`);
  const w = newLevel(1);
  w.things = [];
  w.things.push({
    kind: "monster",
    id: 1,
    z: 12,
    x: 0,
    hp: 3,
    maxHp: 3,
    big: false,
    bite: 1,
    reward: 1,
    speed: 0,
    minion: false,
    dead: false,
  });
  start(w);
  const before = w.count;
  for (let i = 0; i < 60; i++) step(w, 1 / 60);
  assert.equal(w.things[0].kind === "monster" && w.things[0].dead, true);
  assert.equal(w.count, before + 1);

  const v = newLevel(1);
  v.things = [
    {
      kind: "monster",
      id: 1,
      z: 0.3,
      x: 0,
      hp: 99,
      maxHp: 99,
      big: true,
      bite: 3,
      reward: 0,
      speed: 0,
      minion: false,
      dead: false,
    },
  ];
  v.count = 10;
  start(v);
  step(v, 1 / 60);
  assert.equal(v.count, 7);
});

test("the boss summons minions on its way in, then stops once it is close", () => {
  const w = newLevel(3);
  w.things = [];
  w.count = 900;
  w.z = w.boss.z - 14;
  w.phase = "boss";
  w.boss.hp = 99999;
  let far = 0;
  let near = 0;
  for (let i = 0; i < 60 * 14; i++) {
    step(w, 1 / 60);
    const n = w.events.filter((e) => e.type === "summon").length;
    if (w.boss.z - w.z > BOSS_REACH + 5) far += n;
    else near += n;
    w.events.length = 0;
  }
  assert.ok(far >= 2, `${far} summons on the way in`);
  assert.equal(near, 0);
});

test("gate pairs are close calls whose winner depends on the squad size", () => {
  let flips = 0;
  let pairs = 0;
  for (let lv = 1; lv <= 10; lv++)
    for (const g of newLevel(lv).things) {
      if (g.kind !== "gate") continue;
      pairs++;
      const small = applyOp(5, g.left) > applyOp(5, g.right);
      const big = applyOp(200, g.left) > applyOp(200, g.right);
      if (small !== big) flips++;
    }
  assert.ok(flips / pairs > 0.3, `${flips} of ${pairs} pairs flip`);
});

test("weapon crates shot to zero raise damage or fire rate", () => {
  const w = newLevel(4);
  const ups = w.things.filter((t) => t.kind === "block" && t.upgrade);
  assert.ok(ups.length >= 2, `${ups.length} weapon crates`);
  assert.ok(ups.some((t) => t.kind === "block" && t.upgrade === "rate"));
  assert.ok(ups.some((t) => t.kind === "block" && t.upgrade === "power"));

  for (const kind of ["power", "rate"] as const) {
    const v = newLevel(1);
    v.things = [
      {
        kind: "block",
        id: 1,
        z: 8,
        x: 0,
        w: 0.2,
        hp: 3,
        maxHp: 3,
        reward: 0,
        upgrade: kind,
        dead: false,
      },
    ];
    start(v);
    const rate = shotRate(v);
    let got = false;
    for (let i = 0; i < 60 && !got; i++) {
      step(v, 1 / 60);
      got = v.events.some((e) => e.type === "upgrade" && e.kind === kind);
      v.events.length = 0;
    }
    assert.ok(got, `${kind} crate pays out`);
    if (kind === "power") assert.equal(v.power, 2);
    else assert.ok(shotRate(v) > rate * 1.3);
  }
});

test("running past a weapon crate costs nothing", () => {
  const w = newLevel(1);
  w.things = [
    {
      kind: "block",
      id: 1,
      z: 0.3,
      x: 0,
      w: 0.2,
      hp: 999,
      maxHp: 999,
      reward: 0,
      upgrade: "power",
      dead: false,
    },
  ];
  w.count = 10;
  start(w);
  for (let i = 0; i < 30; i++) step(w, 1 / 60);
  assert.equal(w.count, 10);
  assert.equal(w.power, 1);
});

test("a strong shot that kills a slime carries on into the next one", () => {
  const w = newLevel(1);
  const slime = (id: number, z: number) => ({
    kind: "monster" as const,
    id,
    z,
    x: 0,
    hp: 1,
    maxHp: 1,
    big: false,
    bite: 1,
    reward: 0,
    speed: 0,
    minion: false,
    dead: false,
  });
  w.things = [slime(1, 6), slime(2, 6.2)];
  w.power = 2;
  w.bullets = [{ x: 0, z: 5, dmg: 2, dead: false }];
  w.phase = "run";
  w.speed = 0;
  w.fireClock = -999;
  step(w, 1 / 30);
  step(w, 1 / 30);
  assert.ok(w.things.every((t) => t.kind === "monster" && t.dead));
});

test("a failed level pays a coin for every 20% of the enemies destroyed", () => {
  const w = newLevel(4);
  const road = w.things.filter((t) => t.kind === "monster");
  assert.equal(defeated(w), 0);
  assert.equal(lossCoins(w), 0);
  // half the road's monsters shot down, the boss untouched: 25%
  road.slice(0, road.length / 2).forEach((m) => {
    m.dead = true;
    m.hp = 0;
  });
  if (road.length % 2 === 0) assert.equal(defeated(w), 0.25);
  // monsters that bit the squad or were passed don't count
  road.slice(road.length / 2).forEach((m) => (m.dead = true));
  assert.ok(defeated(w) <= 0.25);
  // every monster down and the boss at half health: 75%, 3 coins
  road.forEach((m) => (m.hp = 0));
  w.boss.hp = w.boss.maxHp / 2;
  assert.equal(defeated(w), 0.75);
  assert.equal(lossCoins(w), 3);
  // the boss's minions are left out
  w.things.push({ ...road[0], id: 999, minion: true, dead: false, hp: 5 });
  assert.equal(defeated(w), 0.75);
  w.boss.hp = 0;
  assert.equal(lossCoins(w), 5);
});

test("a cleared level pays 5 coins plus 1 a star, more than any loss", () => {
  assert.equal(winCoins(1), 6);
  assert.equal(winCoins(3), 8);
});

test("every level lays 2 or 3 coin packs on the road, clear of gates and crates", () => {
  for (const lv of [1, 7, 12, 40]) {
    const w = newLevel(lv);
    assert.ok(
      w.coins.length >= MIN_COIN_PACKS && w.coins.length <= MAX_COIN_PACKS,
    );
    const solid = w.things.filter(
      (t) => t.kind === "gate" || t.kind === "block",
    );
    for (const c of w.coins) {
      assert.ok(c.z > solid[0].z && c.z < w.boss.z - BOSS_STOP, `${lv}`);
      assert.ok(Math.abs(c.x) < 0.7);
      assert.ok(c.value >= MIN_PACK_COINS && c.value <= MAX_PACK_COINS);
      assert.ok(c.hp >= c.value);
    }
    // ids stay unique
    const ids = new Set([...w.things, ...w.coins].map((t) => t.id));
    assert.equal(ids.size, w.things.length + w.coins.length);
  }
  // the rest of the layout doesn't change with the coins in it
  assert.deepEqual(
    newLevel(12).things.map((t) => t.z),
    newLevel(12).things.map((t) => t.z),
  );
});

test("shooting a coin pack down to zero collects its coins", () => {
  const w = newLevel(12);
  w.things = [];
  const [c] = w.coins;
  const missed = { ...c, id: 999, x: c.x === 0 ? 0.62 : 0, z: c.z + 0.5 };
  w.coins = [c, missed];
  w.phase = "run";
  w.count = 60;
  w.power = 2;
  w.z = c.z - 25;
  w.x = w.targetX = c.x;
  let hits = 0;
  while (!c.taken && w.z < c.z) {
    step(w, 1 / 60);
    hits += w.events.filter(
      (e) => e.type === "hit" && e.target === "coin",
    ).length;
    w.events.length = 0;
    w.targetX = c.x;
  }
  assert.ok(c.taken, "broken before the squad reached it");
  assert.equal(c.hp, 0);
  assert.ok(hits > 0);
  assert.equal(w.picked, c.value);
  // a pack in another lane isn't touched
  assert.ok(!missed.taken && missed.hp === missed.maxHp);
  // a loss pays the coins collected on top of its share
  w.phase = "lost";
  assert.equal(levelCoins(w), lossCoins(w) + c.value);
});

test("a bigger squad's gunfire is drawn heavier, on a curve", () => {
  assert.equal(volley(1), 1);
  assert.equal(firepower(1), 0);
  assert.ok(volley(50) > volley(5) && volley(5) > volley(1));
  assert.equal(volley(1000), 10);
  // the look keeps growing past the fire-rate cap (about 167 soldiers)
  assert.ok(volley(500) > volley(170));
  assert.ok(firepower(999) > firepower(500));
  assert.equal(volley(MAX_COUNT), 10);
  assert.ok(Math.abs(firepower(1000) - 1) < 1e-9);
  assert.ok(firepower(100) > firepower(10));
});

test("past the fire-rate cap a bigger squad's rounds hit harder", () => {
  assert.equal(heavyRounds(1), 1);
  assert.equal(heavyRounds(150), 1);
  assert.ok(Math.abs(heavyRounds(FULL_RATE_COUNT * 4) - 2) < 1e-9);
  assert.ok(heavyRounds(999) > 2.4 && heavyRounds(999) < 2.5);
  // on average a squad of 999 deals about 2.4x the damage a round
  const w = newLevel(30);
  w.things = [];
  w.phase = "run";
  w.speed = 0;
  w.count = 999;
  let shots = 0;
  let dealt = 0;
  for (let i = 0; i < 300; i++) {
    step(w, 1 / 60);
    for (const b of w.bullets)
      if (!(b as { seen?: boolean }).seen) {
        (b as { seen?: boolean }).seen = true;
        assert.equal(b.dmg, Math.round(b.dmg));
        shots++;
        dealt += b.dmg;
      }
  }
  assert.ok(Math.abs(dealt / shots - heavyRounds(999)) < 0.15);
});
