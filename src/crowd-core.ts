/**
 * Crowd Rush — rules for a crowd-runner shooter.
 *
 * The squad runs forward along a track. The player steers it left and
 * right through number gates (+, −, ×, ÷), the squad fires automatically,
 * shoots open supply crates and walls, and fights rival squads head-on.
 * A boss waits at the end of every level.
 *
 * Everything here is pure and seeded so it can be tested without a canvas.
 * Units: x is the lateral road position in [-1, 1]; z is metres along the
 * track.
 */
export type Op = "+" | "-" | "x" | "/";
export type GateSide = { op: Op; n: number };
export type Gate = {
  kind: "gate";
  id: number;
  z: number;
  left: GateSide;
  right: GateSide;
  used: boolean;
  chosen?: "left" | "right";
  /** Whether the chosen door was the better of the two. */
  wasBest?: boolean;
};
export type Block = {
  kind: "block";
  id: number;
  z: number;
  x: number;
  w: number;
  hp: number;
  maxHp: number;
  /** Crates pay out recruits when shot open; walls only block. */
  reward: number;
  /** Weapon crates: shot to zero, they raise damage ("power") or fire rate. */
  upgrade?: Upgrade;
  dead: boolean;
};
export type Upgrade = "power" | "rate";
export type Squad = {
  kind: "squad";
  id: number;
  z: number;
  x: number;
  count: number;
  start: number;
  dead: boolean;
};
/** Small monsters roam the road; brutes are bigger and free captives. */
export type Monster = {
  kind: "monster";
  id: number;
  z: number;
  x: number;
  hp: number;
  maxHp: number;
  big: boolean;
  /** Squad members lost if it reaches you. */
  bite: number;
  /** Recruits freed when it is shot down. */
  reward: number;
  speed: number;
  /** Summoned by the boss rather than placed on the road. */
  minion: boolean;
  dead: boolean;
};
export type Thing = Gate | Block | Squad | Monster;
/**
 * A pack of dingn coins on the road, showing a number: shoot it down to zero
 * and the squad collects its coins.
 */
export type Coin = {
  kind: "coin";
  id: number;
  z: number;
  x: number;
  hp: number;
  maxHp: number;
  /** dingn coins inside. */
  value: number;
  taken: boolean;
};
export type Boss = {
  z: number;
  hp: number;
  maxHp: number;
  /** Seconds until the next ground slam. */
  slam: number;
  slamEvery: number;
  /** Seconds until the boss calls in more minions. */
  summon: number;
  summonEvery: number;
  minions: number;
};
export type Bullet = { x: number; z: number; dmg: number; dead: boolean };
export type Phase = "ready" | "run" | "boss" | "won" | "lost";
export type GameEvent =
  | {
      type: "gate";
      side: "left" | "right";
      good: boolean;
      before: number;
      after: number;
      z: number;
      x: number;
    }
  | {
      type: "hit";
      x: number;
      z: number;
      target: "block" | "squad" | "boss" | "monster" | "coin";
    }
  | { type: "kill"; x: number; z: number; big: boolean; reward: number }
  | { type: "bite"; x: number; z: number; lost: number }
  | { type: "summon"; count: number }
  | { type: "crate"; x: number; z: number; reward: number }
  | { type: "wall"; x: number; z: number; lost: number }
  | { type: "clash"; x: number; z: number; lost: number }
  | { type: "slam"; lost: number }
  | { type: "upgrade"; kind: Upgrade; level: number; x: number; z: number }
  | { type: "coin"; x: number; z: number; value: number }
  | { type: "won" }
  | { type: "lost" };
export type World = {
  level: number;
  phase: Phase;
  length: number;
  z: number;
  x: number;
  targetX: number;
  count: number;
  best: number;
  speed: number;
  things: Thing[];
  /** dingn coins on the road, and how many the squad has picked up. */
  coins: Coin[];
  picked: number;
  boss: Boss;
  bullets: Bullet[];
  /** Damage per shot, raised by power crates. */
  power: number;
  /** Fire-rate upgrades collected from rate crates. */
  rapid: number;
  /** Permanent upgrades the player bought; none by default. */
  perks: Perks;
  fireClock: number;
  time: number;
  shotsFired: number;
  events: GameEvent[];
  random: () => number;
  nextId: number;
};

export const START_COUNT = 1;
export const MAX_COUNT = 999;
export const RUN_SPEED = 10;
export const BULLET_SPEED = 46;
export const BULLET_RANGE = 21;
/** Distance in front of the boss where the squad halts and opens fire. */
export const BOSS_STOP = 14;
/** How fast the boss stomps toward the squad once the fight starts (m/s). */
export const BOSS_WALK = 1.0;
/** How close the boss gets before it tramples the squad. */
export const BOSS_REACH = 2.5;
/** How far ahead monsters notice the squad and charge. */
export const MONSTER_NOTICE = 42;

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function applyOp(count: number, side: GateSide) {
  switch (side.op) {
    case "+":
      return Math.min(MAX_COUNT, count + side.n);
    case "-":
      return Math.max(0, count - side.n);
    case "x":
      return Math.min(MAX_COUNT, count * side.n);
    case "/":
      return Math.max(0, Math.floor(count / side.n));
  }
}
export const opLabel = (s: GateSide) =>
  `${{ "+": "+", "-": "−", x: "×", "/": "÷" }[s.op]}${s.n}`;
export const isGood = (s: GateSide) => s.op === "+" || s.op === "x";
/** Whether taking `side` of a gate was at least as good as the other door. */
export function bestChoice(count: number, gate: Gate, side: "left" | "right") {
  const other = side === "left" ? "right" : "left";
  return applyOp(count, gate[side]) >= applyOp(count, gate[other]);
}

/** How wide the squad is on the road, given its head count. */
export function crowdRadius(count: number) {
  return Math.min(0.42, 0.07 + Math.sqrt(Math.max(1, count)) * 0.028);
}
export function squadRadius(count: number) {
  return Math.min(0.4, 0.07 + Math.sqrt(Math.max(1, count)) * 0.026);
}
/**
 * Base shots per second: a bigger squad fires faster. It starts slow;
 * rate crates on the road speed it up and power crates make each shot hit
 * harder.
 */
export function fireRate(count: number) {
  return Math.min(20, 4.5 + Math.sqrt(count) * 1.2);
}
export const MAX_POWER = 4;
/**
 * Permanent upgrades bought with dingn coins (crowd-upgrades.ts), up to 3
 * tiers each. Fire rate rises 10% a tier; power gives each shot a 15% chance
 * a tier of hitting twice as hard (a critical hit), so damage stays whole.
 */
export type Perks = { power: number; rate: number };
export const RATE_PERK = 0.1;
export const CRIT_PERK = 0.15;
export const MAX_RAPID = 4;
/** Shots per second for this squad, including rate upgrades. */
export function shotRate(
  w: Pick<World, "count" | "rapid"> & { perks?: Perks },
) {
  return (
    fireRate(w.count) *
    (1 + 0.35 * w.rapid) *
    (1 + RATE_PERK * (w.perks?.rate ?? 0))
  );
}

/**
 * Builds a level. Difficulty follows a rough estimate of how big a squad a
 * reasonable player will have at each point, so every level is winnable by
 * picking the better gate and shooting what is in front of you.
 */
export function newLevel(level: number): World {
  const lv = Math.max(1, Math.floor(level));
  const random = rng(lv * 7919 + 17);
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  const int = (lo: number, hi: number) =>
    lo + Math.floor(random() * (hi - lo + 1));
  // Difficulty keeps climbing with every level; there is no last level.
  const hard = lv + 3;
  const sections = 8 + Math.min(lv, 10);
  const things: Thing[] = [];
  let z = 34;
  let expected = START_COUNT;
  let id = 0;
  let lastKind = "";
  // weapon crates use their own random stream so the rest stays the same
  const upRoll = rng(lv * 31337 + 5);
  let ups = 0;
  /** Expected damage multiplier from the weapon crates collected so far. */
  let gun = 1;
  const gunFor = (n: number) =>
    (1 + Math.floor(n / 2)) * (1 + 0.35 * Math.ceil(n / 2));
  /** Rough squad size along the track, used to size the monsters. */
  const checkpoints: { z: number; expected: number; gun: number }[] = [];
  for (let i = 0; i < sections; i++) {
    // Always open with a gate, never repeat the same obstacle twice in a row.
    const options =
      i === 0
        ? ["gate"]
        : ["gate", "gate", "crates", "walls", "squad"].filter(
            (k) => k !== lastKind,
          );
    const kind = pick(options);
    lastKind = kind;
    checkpoints.push({ z, expected, gun });
    if (kind === "gate") {
      // Both doors look the same, so the player has to do the maths. Most
      // pairs are close calls whose winner depends on the squad's size.
      const e = Math.max(4, expected);
      const around = (k: number, spread: number) =>
        Math.max(2, Math.round(e * k * (1 - spread + random() * spread * 2)));
      const kinds =
        i === 0
          ? ["addMul", "addSub"]
          : [
              "addMul",
              "addMul",
              "addMul3",
              "subDiv",
              "addAdd",
              "mulDiv",
              "addSub",
            ];
      const pairKind = pick(kinds);
      let pair: [GateSide, GateSide];
      if (pairKind === "addMul")
        pair = [
          { op: "+", n: around(1, 0.45) },
          { op: "x", n: 2 },
        ];
      else if (pairKind === "addMul3")
        pair = [
          { op: "+", n: around(2, 0.35) },
          { op: "x", n: 3 },
        ];
      else if (pairKind === "subDiv")
        pair = [
          { op: "-", n: around(0.5, 0.35) },
          { op: "/", n: 2 },
        ];
      else if (pairKind === "mulDiv")
        pair = [
          { op: "x", n: 2 },
          { op: "-", n: around(0.4, 0.3) },
        ];
      else if (pairKind === "addAdd") {
        const a = around(0.6, 0.4);
        pair = [
          { op: "+", n: a },
          { op: "+", n: a + int(-Math.ceil(a / 3), Math.ceil(a / 3)) || a + 1 },
        ];
      } else
        pair = [
          { op: "+", n: around(0.8, 0.4) },
          { op: "-", n: int(2, Math.max(4, Math.round(e * 0.3))) },
        ];
      if (pair[0].op === pair[1].op && pair[0].n === pair[1].n)
        pair[1] = { ...pair[1], n: pair[1].n + 1 };
      const good =
        applyOp(e, pair[0]) >= applyOp(e, pair[1]) ? pair[0] : pair[1];
      const bad = good === pair[0] ? pair[1] : pair[0];
      // A squad that never steers runs through the right-hand door, so the
      // worse door sits there more often than not. The first gate always
      // punishes standing still.
      const badRight = i === 0 || random() < 0.65;
      things.push({
        kind: "gate",
        id: id++,
        z,
        left: badRight ? good : bad,
        right: badRight ? bad : good,
        used: false,
      });
      expected = applyOp(expected, good);
      // after each gate, a weapon crate on one side lane: rate, power, ...
      if (i > 0 && ups < 2 + Math.min(3, Math.floor(lv / 3))) {
        const hp = Math.round(fireRate(expected) * 0.7) + Math.floor(lv / 6);
        things.push({
          kind: "block",
          id: id++,
          z: z + 18,
          x: upRoll() < 0.5 ? -0.62 : 0.62,
          w: 0.2,
          hp,
          maxHp: hp,
          reward: 0,
          upgrade: ups % 2 === 0 ? "rate" : "power",
          dead: false,
        });
        ups++;
        gun = gunFor(ups);
      }
      z += 30;
    } else if (kind === "crates") {
      // a row of crates always leaves one lane open to slip past
      const open = int(0, 2);
      const lanes = [-0.62, 0, 0.62].filter(
        (_, i) => i !== open && random() < 0.85,
      );
      if (!lanes.length) lanes.push(open === 1 ? 0.62 : 0);
      for (const x of lanes) {
        const value =
          Math.max(4, Math.round(expected * (0.18 + random() * 0.12))) + lv;
        // shots are slower now, so crates take fewer hits than they pay
        const hp = Math.max(3, Math.round(value * 0.6));
        const reward = Math.max(3, Math.round(value * 0.5));
        things.push({
          kind: "block",
          id: id++,
          z,
          x,
          w: 0.22,
          hp,
          maxHp: hp,
          reward,
          dead: false,
        });
      }
      expected += 6;
      z += 26;
    } else if (kind === "walls") {
      const gap = pick([-0.62, 0.62]);
      for (const x of [-0.62, 0, 0.62]) {
        if (x === gap) continue;
        const hp = int(10, 16) + lv * 6;
        things.push({
          kind: "block",
          id: id++,
          z,
          x,
          w: 0.27,
          hp,
          maxHp: hp,
          reward: 0,
          dead: false,
        });
      }
      z += 26;
    } else {
      const count = Math.max(
        4,
        Math.round(expected * (0.3 + random() * 0.25)) +
          Math.min(Math.floor(hard / 3), Math.floor(expected / 4)),
      );
      things.push({
        kind: "squad",
        id: id++,
        z: z + 8,
        x: (random() * 2 - 1) * 0.45,
        count,
        start: count,
        dead: false,
      });
      expected = Math.max(START_COUNT, expected - Math.floor(count * 0.6));
      z += 34;
    }
  }
  const length = z + 30;

  // Monsters fill the stretches between gates and obstacles. They use their
  // own random stream so the rest of the layout stays the same.
  const roll = rng(lv * 104729 + 3);
  const busy = things.map((t) => t.z);
  let pack = 0;
  const firstGate = things[0]?.z ?? 30;
  // Monsters arrive faster at higher levels: the share of the squad's
  // firepower needed to hold them off keeps climbing, with no cap on the
  // level (it only levels off near the point where nothing could keep up).
  const pressure = 0.5 + 0.45 * (1 - 1 / (1 + hard / 12));
  let mz = firstGate + 10;
  while (mz < length - BOSS_STOP - 6) {
    const near = [...checkpoints].reverse().find((c) => c.z <= mz);
    const size = Math.max(1, near?.expected ?? START_COUNT);
    const g = near?.gun ?? 1;
    const dps = fireRate(size) * g;
    // the gap that keeps this group's hit points within the pressure budget
    const gap = (hp: number, closing: number) =>
      Math.max(1.8, (hp * closing) / (pressure * dps)) * (0.8 + roll() * 0.4);
    if (busy.some((bz) => Math.abs(bz - mz) < 4)) {
      mz += 2;
      continue;
    }
    pack++;
    const brute = pack >= 4 && size >= 16;
    if (brute) {
      pack = 0;
      const hp = Math.round(
        Math.min(12 + hard * 2, size * 0.45 + 3) * Math.sqrt(g),
      );
      things.push(
        monster(
          id++,
          mz,
          (roll() * 2 - 1) * 0.55,
          true,
          hp,
          Math.min(2 + Math.floor(hard / 4), Math.max(2, Math.floor(size / 6))),
          2 + Math.floor(lv / 3),
          3,
        ),
      );
      mz += gap(hp, RUN_SPEED + 3);
      continue;
    }
    // small squads meet single slimes; bigger ones meet packs
    const n =
      (size >= 10 ? 3 : size >= 4 ? 2 : 1) +
      Math.floor(roll() * Math.min(6, 1 + Math.sqrt(size) / 2, 2 + hard / 3));
    // many small slimes, so each one is weak
    const hp = Math.max(
      1,
      Math.round(Math.min(1 + hard / 8, Math.sqrt(size) * 0.25) * Math.sqrt(g)),
    );
    const bite = Math.max(
      1,
      Math.min(1 + Math.floor(hard / 8), Math.floor(size / 10)),
    );
    for (let k = 0; k < n; k++)
      things.push(
        monster(
          id++,
          mz + k * 0.9,
          (roll() * 2 - 1) * 0.75,
          false,
          hp,
          bite,
          0,
          4.5,
        ),
      );
    mz += n * 0.9 + gap(hp * n, RUN_SPEED + 4.5);
  }

  // A horde guards the boss: rows of monsters charge out to meet the squad.
  const finalSize = Math.max(4, expected);
  const hordeHp = Math.max(
    1,
    Math.round(
      Math.min(2 + hard / 6, Math.sqrt(finalSize) * 0.3) * Math.sqrt(gun),
    ),
  );
  const rows = 3 + Math.min(9, Math.floor(hard / 3));
  for (let r = 0; r < rows; r++) {
    const hz = length - BOSS_STOP - 26 + r * 2.4;
    const across = 3 + Math.floor(roll() * Math.min(5, 2 + hard / 6));
    for (let k = 0; k < across; k++)
      things.push(
        monster(
          id++,
          hz + roll() * 0.8,
          -0.8 + (1.6 * (k + roll() * 0.6)) / across,
          false,
          hordeHp,
          1,
          1,
          4.5,
        ),
      );
    if (r % 3 === 2 && finalSize >= 12)
      things.push(
        monster(
          id++,
          hz + 1,
          (roll() * 2 - 1) * 0.4,
          true,
          Math.round(
            Math.min(30 + hard * 2, finalSize * 0.35 + 6) * Math.sqrt(gun),
          ),
          Math.min(4 + hard, Math.max(2, Math.floor(finalSize / 8))),
          2 + Math.floor(lv / 3),
          3,
        ),
      );
  }
  things.sort((a, b) => a.z - b.z);
  const coins = placeCoins(lv, things, checkpoints, firstGate, length, id);
  id += coins.length;

  // Levels 1 to 10 are eased in so new players find their feet: monsters
  // and the boss are weaker and the boss is slower, by 30% on level 1,
  // fading out level by level until it is gone from level 11 on. The track
  // itself (gates, crates and walls) is the same.
  const soften = 1 - 0.3 * (Math.max(0, 11 - lv) / 10);
  for (const t of things)
    if (t.kind === "monster") {
      t.hp = t.maxHp = Math.max(1, Math.round(t.maxHp * soften));
      t.bite = Math.max(1, Math.round(t.bite * soften));
    }

  // seconds of full fire the boss soaks up, assuming every weapon crate
  const bossHp = Math.round(
    fireRate(expected) * gun ** 0.9 * (5 + 2 * Math.sqrt(hard)) * soften,
  );
  return {
    level: lv,
    phase: "ready",
    length,
    z: 0,
    x: 0,
    targetX: 0,
    count: START_COUNT,
    best: START_COUNT,
    speed: RUN_SPEED,
    things,
    coins,
    picked: 0,
    boss: {
      z: length,
      hp: bossHp,
      maxHp: bossHp,
      slam: 2.2,
      slamEvery: Math.max(0.7, 1.8 - hard * 0.05) / soften,
      summon: 1.2,
      summonEvery: Math.max(1.2, 2.6 - hard * 0.06) / soften,
      minions: Math.min(9, 2 + Math.floor(hard / 3)),
    },
    bullets: [],
    power: 1,
    rapid: 0,
    perks: { power: 0, rate: 0 },
    fireClock: 0,
    time: 0,
    shotsFired: 0,
    events: [],
    random,
    nextId: id,
  };
}

/** Coin packs along each level's road: 2 or 3, holding 3 to 10 coins each. */
export const MIN_COIN_PACKS = 2;
export const MAX_COIN_PACKS = 3;
export const MIN_PACK_COINS = 3;
export const MAX_PACK_COINS = 10;
/** How big a coin pack is drawn: fuller packs are bigger. */
export const packSize = (value: number) => 1.2 + (value - 3) * 0.06;
/** How wide a coin pack is to a bullet, in road units. */
export const COIN_HALF = 0.14;
/**
 * Puts 2 or 3 coin packs along the road, one in each stretch between the
 * first gate and the horde, in a random lane but clear of gates and crates.
 * A pack's number is about 0.75 to 1.4 seconds of the squad's expected
 * firepower at that point, more for a fuller pack, so it grows level by level
 * and a pack can be broken in the two seconds it is in range by keeping the
 * squad lined up with it. A stream of its own keeps the rest of the layout the
 * same.
 */
function placeCoins(
  lv: number,
  things: Thing[],
  checkpoints: { z: number; expected: number; gun: number }[],
  from: number,
  length: number,
  firstId: number,
): Coin[] {
  const roll = rng(lv * 7477 + 11);
  const solid = things
    .filter((t) => t.kind === "gate" || t.kind === "block")
    .map((t) => t.z);
  const start = from + 6;
  const packs =
    MIN_COIN_PACKS + Math.floor(roll() * (MAX_COIN_PACKS - MIN_COIN_PACKS + 1));
  const span = (length - BOSS_STOP - 30 - start) / packs;
  // levels 1 to 10 are eased in, as for the monsters
  const soften = 1 - 0.3 * (Math.max(0, 11 - lv) / 10);
  const coins: Coin[] = [];
  for (let i = 0; i < packs; i++) {
    let z = start + span * (i + 0.15 + roll() * 0.7);
    for (
      let tries = 0;
      tries < 8 && solid.some((s) => Math.abs(s - z) < 4);
      tries++
    )
      z += 3;
    const value =
      MIN_PACK_COINS +
      Math.floor(roll() * (MAX_PACK_COINS - MIN_PACK_COINS + 1));
    const near = [...checkpoints].reverse().find((c) => c.z <= z);
    const dps =
      fireRate(Math.max(START_COUNT, near?.expected ?? START_COUNT)) *
      Math.sqrt(near?.gun ?? 1);
    const hp = Math.max(value, Math.round(dps * (0.5 + value * 0.09) * soften));
    coins.push({
      kind: "coin",
      id: firstId + i,
      z,
      x: [-0.62, 0, 0.62][Math.floor(roll() * 3)],
      hp,
      maxHp: hp,
      value,
      taken: false,
    });
  }
  return coins;
}

function monster(
  id: number,
  z: number,
  x: number,
  big: boolean,
  hp: number,
  bite: number,
  reward: number,
  speed: number,
  minion = false,
): Monster {
  return {
    kind: "monster",
    id,
    z,
    x,
    hp,
    maxHp: hp,
    big,
    bite,
    reward,
    speed,
    minion,
    dead: false,
  };
}
export const monsterRadius = (m: Monster) => (m.big ? 0.15 : 0.09);

export function start(w: World) {
  if (w.phase === "ready") w.phase = "run";
}

/** Set where the player wants the squad to be, in road units. */
export function steer(w: World, x: number) {
  const limit = 1 - crowdRadius(w.count) * 0.6;
  w.targetX = Math.max(-limit, Math.min(limit, x));
}

function lose(w: World) {
  w.count = 0;
  w.phase = "lost";
  w.bullets = [];
  w.events.push({ type: "lost" });
}

/** Advances the world by dt seconds. Events since the last call are in w.events. */
export function step(w: World, dt: number) {
  if (w.phase !== "run" && w.phase !== "boss") return;
  w.time += dt;

  // steering eases toward the target; a big squad is a little slower to turn
  const r = crowdRadius(w.count);
  const limit = 1 - r * 0.6;
  w.targetX = Math.max(-limit, Math.min(limit, w.targetX));
  const turn = 3.4 - r * 2;
  const dx = w.targetX - w.x;
  w.x += Math.sign(dx) * Math.min(Math.abs(dx), turn * dt);

  const prevZ = w.z;
  if (w.phase === "run") {
    w.z = Math.min(w.z + w.speed * dt, w.boss.z - BOSS_STOP);
    if (w.z >= w.boss.z - BOSS_STOP) w.phase = "boss";
  }

  // rival squads march toward you once they're close
  for (const t of w.things)
    if (t.kind === "squad" && !t.dead && t.z - w.z < 26) {
      t.z -= 2.5 * dt;
      t.x += Math.sign(w.x - t.x) * Math.min(Math.abs(w.x - t.x), 0.25 * dt);
    }

  // monsters charge at the squad once they notice it, homing in on it
  for (const t of w.things)
    if (t.kind === "monster" && !t.dead && t.z - w.z < MONSTER_NOTICE) {
      t.z -= t.speed * dt;
      const drift = t.big ? 0.9 : 1.6;
      t.x += Math.sign(w.x - t.x) * Math.min(Math.abs(w.x - t.x), drift * dt);
    }

  // gates
  for (const t of w.things) {
    if (t.kind !== "gate" || t.used || t.z > w.z || t.z <= prevZ - 0.001)
      continue;
    t.used = true;
    t.chosen = w.x < 0 ? "left" : "right";
    const side = t[t.chosen];
    const before = w.count;
    const best = bestChoice(before, t, t.chosen);
    t.wasBest = best;
    w.count = applyOp(w.count, side);
    w.events.push({
      type: "gate",
      side: t.chosen,
      good: best,
      before,
      after: w.count,
      z: t.z,
      x: t.chosen === "left" ? -0.5 : 0.5,
    });
    if (w.count <= 0) return lose(w);
  }

  // shooting
  w.fireClock += dt * shotRate(w);
  while (w.fireClock >= 1) {
    w.fireClock -= 1;
    w.shotsFired++;
    w.bullets.push({
      x: w.x + (w.random() * 2 - 1) * r * 0.7,
      z: w.z + 0.8,
      // an upgraded weapon sometimes lands a critical hit
      dmg:
        w.perks.power > 0 && w.random() < CRIT_PERK * w.perks.power
          ? w.power * 2
          : w.power,
      dead: false,
    });
  }
  for (const b of w.bullets) {
    const from = b.z;
    b.z += BULLET_SPEED * dt;
    if (b.z - w.z > BULLET_RANGE) {
      b.dead = true;
      continue;
    }
    let hit: Thing | Coin | "boss" | undefined;
    let hitZ = Infinity;
    for (const t of w.things) {
      if (t.kind === "gate" || t.dead) continue;
      if (t.z < from - 0.5 || t.z > b.z + 0.5 || t.z >= hitZ) continue;
      const half =
        t.kind === "block"
          ? t.w
          : t.kind === "monster"
            ? monsterRadius(t)
            : squadRadius(t.count);
      if (Math.abs(b.x - t.x) <= half) {
        hit = t;
        hitZ = t.z;
      }
    }
    for (const c of w.coins) {
      if (c.taken || c.z < from - 0.5 || c.z > b.z + 0.5 || c.z >= hitZ)
        continue;
      if (Math.abs(b.x - c.x) <= COIN_HALF) {
        hit = c;
        hitZ = c.z;
      }
    }
    if (!hit && w.boss.hp > 0 && b.z >= w.boss.z - 1.5 && Math.abs(b.x) < 0.75)
      hit = "boss";
    if (!hit) continue;
    b.dead = true;
    if (hit === "boss") {
      w.boss.hp = Math.max(0, w.boss.hp - b.dmg);
      w.events.push({ type: "hit", x: b.x, z: w.boss.z, target: "boss" });
      if (w.boss.hp === 0) {
        w.phase = "won";
        w.bullets = [];
        w.events.push({ type: "won" });
        return;
      }
    } else if (hit.kind === "coin") {
      hit.hp = Math.max(0, hit.hp - b.dmg);
      w.events.push({ type: "hit", x: b.x, z: hit.z, target: "coin" });
      if (hit.hp <= 0) {
        hit.taken = true;
        w.picked += hit.value;
        w.events.push({ type: "coin", x: hit.x, z: hit.z, value: hit.value });
      }
    } else if (hit.kind === "block") {
      hit.hp = Math.max(0, hit.hp - b.dmg);
      w.events.push({ type: "hit", x: b.x, z: hit.z, target: "block" });
      if (hit.hp <= 0) {
        hit.dead = true;
        if (hit.upgrade === "power" && w.power < MAX_POWER) w.power++;
        if (hit.upgrade === "rate" && w.rapid < MAX_RAPID) w.rapid++;
        if (hit.upgrade)
          w.events.push({
            type: "upgrade",
            kind: hit.upgrade,
            level: hit.upgrade === "power" ? w.power : w.rapid + 1,
            x: hit.x,
            z: hit.z,
          });
        if (hit.reward) {
          w.count = Math.min(MAX_COUNT, w.count + hit.reward);
          w.events.push({
            type: "crate",
            x: hit.x,
            z: hit.z,
            reward: hit.reward,
          });
        }
      }
    } else if (hit.kind === "squad") {
      hit.count = Math.max(0, hit.count - b.dmg);
      w.events.push({ type: "hit", x: b.x, z: hit.z, target: "squad" });
      if (hit.count <= 0) hit.dead = true;
    } else if (hit.kind === "monster") {
      // a shot that kills a monster carries its leftover damage onward
      const dealt = Math.min(b.dmg, hit.hp);
      hit.hp -= dealt;
      b.dmg -= dealt;
      if (b.dmg > 0) b.dead = false;
      w.events.push({ type: "hit", x: b.x, z: hit.z, target: "monster" });
      if (hit.hp <= 0) {
        hit.dead = true;
        w.count = Math.min(MAX_COUNT, w.count + hit.reward);
        w.events.push({
          type: "kill",
          x: hit.x,
          z: hit.z,
          big: hit.big,
          reward: hit.reward,
        });
      }
    }
  }
  w.bullets = w.bullets.filter((b) => !b.dead);

  // collisions with blocks and squads
  const rr = crowdRadius(w.count);
  for (const t of w.things) {
    if (t.kind === "gate" || t.dead || t.z > w.z + 0.6) continue;
    // anything more than a body length behind the squad has been passed
    if (t.z < w.z - 0.8) {
      t.dead = true;
      continue;
    }
    if (t.kind === "block") {
      if (t.upgrade) continue;
      if (Math.abs(t.x - w.x) < t.w + rr * 0.8) {
        const lost = Math.min(w.count, Math.ceil(t.hp / 2));
        w.count -= lost;
        t.dead = true;
        w.events.push({ type: "wall", x: t.x, z: t.z, lost });
      }
    } else if (t.kind === "monster") {
      if (Math.abs(t.x - w.x) < monsterRadius(t) + rr) {
        const lost = Math.min(w.count, t.bite);
        w.count -= lost;
        t.dead = true;
        w.events.push({ type: "bite", x: t.x, z: t.z, lost });
      }
    } else {
      if (Math.abs(t.x - w.x) < squadRadius(t.count) + rr) {
        const lost = Math.min(w.count, t.count);
        w.count -= lost;
        t.count -= lost;
        t.dead = true;
        w.events.push({ type: "clash", x: t.x, z: t.z, lost });
      }
    }
    if (w.count <= 0) return lose(w);
  }

  // the boss stomps toward the squad, slamming the ground as it comes
  if (w.phase === "boss") {
    w.boss.z = Math.max(w.z + BOSS_REACH, w.boss.z - BOSS_WALK * dt);
    // once it is on top of the squad it tramples twice as often
    const trampling = w.boss.z <= w.z + BOSS_REACH + 0.01;
    w.boss.slam -= dt * (trampling ? 2 : 1);
    if (w.boss.slam <= 0) {
      w.boss.slam += w.boss.slamEvery;
      const lost = Math.min(
        w.count,
        2 + Math.ceil(w.count * (trampling ? 0.12 : 0.07)),
      );
      w.count -= lost;
      w.events.push({ type: "slam", lost });
      if (w.count <= 0) return lose(w);
    }
    // ...and keeps calling in minions to swarm you
    // (it stops once it is close: minions would land right on the squad)
    if (w.boss.z - w.z > BOSS_REACH + 5) w.boss.summon -= dt;
    if (w.boss.summon <= 0) {
      w.boss.summon += w.boss.summonEvery;
      const hp =
        1 +
        Math.floor((Math.sqrt(w.count) / 4) * w.power) +
        Math.floor(w.level / 6);
      for (let k = 0; k < w.boss.minions; k++)
        w.things.push(
          monster(
            w.nextId++,
            w.boss.z - 2 - w.random() * 1.5,
            (w.random() * 2 - 1) * 0.6,
            false,
            hp,
            1,
            0,
            6,
            true,
          ),
        );
      w.things = w.things.filter(
        (t) => !(t.kind === "monster" && t.dead && t.minion),
      );
      w.events.push({ type: "summon", count: w.boss.minions });
    }
  }
  w.best = Math.max(w.best, w.count);
}

/** Stars for a cleared level: based on how much of the squad survived. */
export function stars(w: World) {
  if (w.phase !== "won") return 0;
  const share = w.count / Math.max(1, w.best);
  return share > 0.6 ? 3 : share > 0.3 ? 2 : 1;
}

export function progress(w: World) {
  return Math.min(1, w.z / Math.max(1, w.boss.z - BOSS_STOP));
}

/**
 * How much of a level's enemies the squad destroyed, from 0 to 1: the share
 * of road monsters shot down and the share of the boss's health taken, half
 * each (all boss when the road has no monsters). Monsters the boss summons
 * don't count.
 */
export function defeated(w: World) {
  const road = w.things.filter(
    (t): t is Monster => t.kind === "monster" && !t.minion,
  );
  const boss = 1 - w.boss.hp / Math.max(1, w.boss.maxHp);
  if (!road.length) return boss;
  const killed = road.filter((m) => m.dead && m.hp <= 0).length;
  return (killed / road.length + boss) / 2;
}

/** dingn coins for a failed level: 1 for every 20% of the enemies destroyed. */
export const LOSS_COINS = 5;
export const lossCoins = (w: World) =>
  Math.floor(defeated(w) * LOSS_COINS + 1e-9);

/**
 * dingn coins for a cleared level: 5, plus 1 for each star (6 to 8), so a
 * win always pays more than a loss. Level badges pay on top, every 5 levels.
 */
export const WIN_COINS = 5;
export const winCoins = (stars: number) =>
  WIN_COINS + Math.max(0, Math.min(3, stars));
/**
 * Everything a finished level pays: the win (or the share of a loss) plus
 * the coins picked up on the road. dingn caps what a game pays for play each
 * UTC day (200 coins a player).
 */
export const levelCoins = (w: World) =>
  w.picked + (w.phase === "won" ? winCoins(stars(w)) : lossCoins(w));
