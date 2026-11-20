import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { DingnGame, Locale } from "../sdk/dingn-sdk.js";
import { CrowdGame } from "../src/crowd-game";
import { DingnProvider } from "../src/dingn";
import { loadStore } from "../src/crowd-shared";

const mocks = vi.hoisted(() => ({
  webgl: true,
  /** Set to make the squad fall on the next game step. */
  fall: false,
  scene: null as { translate: (text: string) => string } | null,
  /** Holds the scene's downloads until a test lets them finish. */
  hold: null as null | {
    started?: boolean;
    progress: (k: number) => void;
    done: () => void;
  },
}));
// The real game rules, except that a test can make the squad fall.
vi.mock("../src/crowd-core", async (real) => {
  const core = await real<typeof import("../src/crowd-core")>();
  return {
    ...core,
    step: (w: Parameters<typeof core.step>[0], dt: number) => {
      if (!mocks.fall || w.phase === "lost") return core.step(w, dt);
      mocks.fall = false;
      w.count = 0;
      w.phase = "lost";
    },
  };
});
// A stand-in for the three.js scene, so overlays stay up while a test runs.
vi.mock("../src/crowd-scene", () => ({
  CrowdScene: class {
    translate = (text: string) => text;
    constructor() {
      if (!mocks.webgl) throw new Error("no WebGL");
      mocks.scene = this;
    }
    resize() {}
    load() {}
    relabel() {}
    loadModels = () => Promise.resolve();
    preload = (progress: (share: number) => void) => {
      if (!mocks.hold) {
        progress(1);
        return Promise.resolve();
      }
      const hold = mocks.hold;
      return new Promise<void>((done) => {
        hold.progress = progress;
        hold.done = done;
        hold.started = true;
      });
    };
    render() {}
    project = () => ({ x: 0, y: 0, visible: false });
    dispose() {}
  },
}));

/** A fake dingn website: device storage, account progress and calls made. */
let stored: Map<string, string>;
let sdk: DingnGame;
const calls = {
  load: vi.fn<() => Promise<unknown>>(),
  save: vi.fn<(data: unknown) => Promise<void>>(),
  signIn: vi.fn<() => void>(),
  navigate: vi.fn<(path: string) => void>(),
};
function fakeSdk(signedIn: boolean, locale: Locale = "en") {
  stored = new Map();
  calls.load.mockReset().mockResolvedValue(null);
  calls.save.mockReset().mockResolvedValue(undefined);
  calls.signIn.mockReset();
  calls.navigate.mockReset();
  sdk = {
    gameId: "crowd",
    version: "1.0.0",
    locale,
    player: { signedIn, name: signedIn ? "Ada" : "", avatar: "" },
    embedded: true,
    challenge: null,
    challengeLink: async () => "",
    roundEnded: () => {},
    onPlayer: () => () => {},
    storage: {
      get: async (key) => stored.get(key) ?? null,
      set: async (key, value) => void stored.set(key, String(value)),
    },
    progress: {
      load: calls.load as DingnGame["progress"]["load"],
      save: calls.save as DingnGame["progress"]["save"],
    },
    rewards: {
      unlock: async () => ({ new: true, coins: 10 }),
      list: async () => [],
      spend: async () => ({ new: true, coins: 50 }),
      shop: async () => [],
      earn: async (coins) => ({ coins, left: 30 - coins }),
    },
    requestSignIn: calls.signIn,
    navigate: calls.navigate,
    ready() {},
  };
}
async function play(saved: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(saved)) stored.set(k, v);
  await loadStore(sdk.storage);
  return render(
    <DingnProvider sdk={sdk}>
      <CrowdGame />
    </DingnProvider>,
  );
}

beforeEach(() => {
  fakeSdk(false);
  mocks.webgl = true;
  mocks.hold = null;
  mocks.fall = false;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("starts at the saved level and names the game for screen readers", async () => {
  await play({ level: "4" });
  expect(
    await screen.findByRole("heading", { name: "Crowd Rush" }),
  ).toBeTruthy();
  expect(screen.getAllByText("Level 4").length).toBeGreaterThan(0);
});

test("shows a loading bar, not the level, until the scenery is in", async () => {
  mocks.hold = { progress: () => {}, done: () => {} };
  await play();
  const bar = await screen.findByRole("progressbar");
  await waitFor(() => expect(mocks.hold?.started).toBe(true));
  expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  await act(async () => mocks.hold?.progress(0.42));
  expect(bar.getAttribute("aria-valuenow")).toBe("42");
  expect(screen.getByText("Loading 42%")).toBeTruthy();
  await act(async () => mocks.hold?.done());
  expect(await screen.findByRole("button", { name: "Start" })).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
});

test("a returning player gets badges for levels cleared before, at sign-in", async () => {
  fakeSdk(true);
  const unlocked: string[] = [];
  sdk.rewards.list = async () => [
    { id: "level-5", earned: true } as Awaited<
      ReturnType<DingnGame["rewards"]["list"]>
    >[number],
  ];
  sdk.rewards.unlock = async (id) => {
    unlocked.push(id);
    return { new: true, coins: 10 };
  };
  calls.load.mockResolvedValue({ level: 35, best: 34 });
  await play();
  await waitFor(() => expect(unlocked).toContain("level-30"));
  expect(unlocked).toEqual([
    "first-win",
    "level-10",
    "level-15",
    "level-20",
    "level-25",
    "level-30",
  ]);
});

test("a signed-in player buys upgrades with dingn coins on the start screen", async () => {
  fakeSdk(true);
  const owned = new Set<string>();
  const spent: string[] = [];
  sdk.rewards.shop = async () =>
    ["power-1", "power-2", "power-3", "rate-1", "rate-2", "rate-3"].map(
      (id) => ({ id, price: 50, title: id, owned: owned.has(id) }),
    );
  sdk.rewards.spend = async (id) => {
    spent.push(id);
    owned.add(id);
    return { new: true, coins: 50 };
  };
  await play({ level: "3" });
  const buy = await screen.findByRole("button", {
    name: "Buy Power +1 for 50 coins",
  });
  await act(async () => fireEvent.click(buy));
  expect(spent).toEqual(["power-1"]);
  expect(
    await screen.findByRole("button", { name: "Buy Power +2 for 120 coins" }),
  ).toBeTruthy();
  // a player without enough coins is told how to earn them
  sdk.rewards.spend = async () => {
    throw Object.assign(new Error("poor"), {
      code: "not_enough_coins",
      balance: 20,
    });
  };
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Buy Fire rate +1 for 50 coins" }),
    ),
  );
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByText("Not enough coins")).toBeTruthy();
  expect(screen.getByText(/costs 50 coins/)).toBeTruthy();
  expect(screen.getByText("You have 20, so you need 30 more.")).toBeTruthy();
});

test("signed-out players see the upgrades, and buying asks them to sign in", async () => {
  await play({ level: "2" });
  expect(await screen.findByRole("button", { name: "Start" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Buy / })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Sign in to buy Power +1" }),
  );
  expect(calls.signIn).toHaveBeenCalled();
});

test("once today's coins are collected, the road has no coin packs", async () => {
  const world = () =>
    (
      window as unknown as {
        __crowd: { current: { coins: { taken: boolean }[] } };
      }
    ).__crowd.current;
  fakeSdk(true);
  await play({ level: "3", coinsDone: new Date().toISOString().slice(0, 10) });
  // the 3D scene loads lazily, which can take a while on the first test run
  const start = await screen.findByRole(
    "button",
    { name: "Start" },
    { timeout: 5000 },
  );
  await act(async () => fireEvent.click(start));
  expect(world().coins.length).toBeGreaterThan(0);
  expect(world().coins.every((c) => c.taken)).toBe(true);
  expect(screen.queryByLabelText(/coins picked up/)).toBeNull();
  cleanup();
  // a new day brings them back
  fakeSdk(true);
  await play({ level: "3", coinsDone: "2000-01-01" });
  const again = await screen.findByRole(
    "button",
    { name: "Start" },
    { timeout: 5000 },
  );
  await act(async () => fireEvent.click(again));
  expect(world().coins.some((c) => !c.taken)).toBe(true);
  expect(screen.getByLabelText("0 coins picked up")).toBeTruthy();
});

test("the run that collects today's last coins offers more coins", async () => {
  fakeSdk(true);
  sdk.rewards.earn = async (coins) => ({ coins, left: 0 });
  await play({ level: "3" });
  const start = await screen.findByRole(
    "button",
    { name: "Start" },
    { timeout: 5000 },
  );
  await act(async () => fireEvent.click(start));
  const w = (
    window as unknown as {
      __crowd: { current: { boss: { hp: number } } };
    }
  ).__crowd.current;
  // the boss is beaten halfway, then the squad falls: a loss that pays
  w.boss.hp /= 2;
  mocks.fall = true;
  const more = await screen.findByRole(
    "button",
    { name: "Get more coins" },
    { timeout: 3000 },
  );
  expect(
    screen.getByText(/Daily coins collected. You can still play/),
  ).toBeTruthy();
  fireEvent.click(more);
  expect(calls.navigate).toHaveBeenCalledWith("/coins/");
  expect(stored.get("coinsDone")).toBe(new Date().toISOString().slice(0, 10));
});

test("levels 1 to 5 play without an account", async () => {
  await play({ level: "5" });
  expect(await screen.findByRole("button", { name: "Start" })).toBeTruthy();
  expect(
    screen.queryByRole("heading", { name: "Save your progress to keep going" }),
  ).toBeNull();
  // no sign-in nag before level 6
  expect(screen.queryByText(/Progress is saved/)).toBeNull();
});

test("level 6 asks a signed-out player to sign in, with a way back", async () => {
  await play({ level: "6", best: "5" });
  expect(
    await screen.findByRole("heading", {
      name: "Save your progress to keep going",
    }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Sign in to keep playing" }),
  );
  expect(calls.signIn).toHaveBeenCalledTimes(1);
  // Enter does not start a locked level
  fireEvent.keyDown(screen.getByRole("application"), { key: "Enter" });
  expect(
    screen.getByText("Level 6", { selector: ".crowd-level" }),
  ).toBeTruthy();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Replay level 5" })),
  );
  expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  expect(screen.getAllByText("Level 5").length).toBeGreaterThan(0);
});

test("signed-in players play past level 5 and merge progress with the account", async () => {
  fakeSdk(true);
  calls.load.mockResolvedValue({ level: 9, best: 8 });
  await play({ level: "6", best: "5" });
  await waitFor(() =>
    expect(screen.getAllByText("Level 9").length).toBeGreaterThan(0),
  );
  expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  await waitFor(() => expect(stored.get("level")).toBe("9"));
  expect(stored.get("best")).toBe("8");
  // the account already had the furthest progress, so nothing is written
  expect(calls.save).not.toHaveBeenCalled();
});

test("progress made on this device is uploaded on sign-in", async () => {
  fakeSdk(true);
  calls.load.mockResolvedValue({ level: 3, best: 2 });
  await play({ level: "8", best: "7" });
  await waitFor(() =>
    expect(calls.save).toHaveBeenCalledWith({ level: 8, best: 7 }),
  );
  expect(screen.getAllByText("Level 8").length).toBeGreaterThan(0);
});

test("explains when WebGL is unavailable and goes back to the games", async () => {
  mocks.webgl = false;
  await play();
  expect(
    await screen.findByRole("heading", { name: "3D isn't available here" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back to games" }));
  expect(calls.navigate).toHaveBeenCalledWith("/");
  fireEvent.keyDown(screen.getByRole("application"), { key: "Enter" });
});

test("sound preference is remembered", async () => {
  await play();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Sound on" })),
  );
  expect(stored.get("sound")).toBe("off");
});

test("the game is translated into Simplified Chinese", async () => {
  fakeSdk(false, "zh-CN");
  await play();
  expect(await screen.findByRole("heading", { name: "人潮突击" })).toBeTruthy();
  expect(screen.getAllByText("第 1 关").length).toBeGreaterThan(0);
});

test("words painted on the 3D crates are translated into Simplified Chinese", async () => {
  fakeSdk(false, "zh-CN");
  mocks.scene = null;
  await play();
  await waitFor(() => expect(mocks.scene).not.toBeNull());
  await waitFor(() => expect(mocks.scene!.translate("RATE")).toBe("射速"));
  expect(mocks.scene!.translate("POWER")).toBe("伤害");
  expect(mocks.scene!.translate("RATE+")).toBe("射速+");
  expect(mocks.scene!.translate("DMG+")).toBe("伤害+");
});

test("the sign-in prompt is translated into Simplified Chinese", async () => {
  fakeSdk(false, "zh-CN");
  await play({ level: "6" });
  expect(
    await screen.findByRole("heading", { name: "保存进度，继续闯关" }),
  ).toBeTruthy();
  expect(
    screen.getByText(/你已经通过了前 5 关。免费登录即可挑战第 6 关/),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "登录继续玩" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "重玩第 5 关" })).toBeTruthy();
});

test("the pause menu holds the run and restarts the level as an easier try", async () => {
  fakeSdk(true);
  const earned: number[] = [];
  sdk.rewards.earn = async (coins) => {
    earned.push(coins);
    return { coins, left: 30 - coins };
  };
  await play({ level: "3" });
  const start = await screen.findByRole(
    "button",
    { name: "Start" },
    { timeout: 5000 },
  );
  await act(async () => fireEvent.click(start));
  const w = (
    window as unknown as {
      __crowd: { current: { z: number; phase: string; boss: { hp: number } } };
    }
  ).__crowd.current;
  fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
  expect(screen.getByRole("dialog", { name: "Paused" })).toBeTruthy();
  // nothing moves while paused
  const z = w.z;
  await new Promise((r) => setTimeout(r, 150));
  expect(w.z).toBe(z);
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  await waitFor(() => expect(w.z).toBeGreaterThan(z));
  // half the boss beaten, then the player gives up: they keep those coins
  w.boss.hp /= 2;
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  fireEvent.click(screen.getByRole("button", { name: "Restart level" }));
  expect(await screen.findByRole("button", { name: "Start" })).toBeTruthy();
  expect(screen.getByText("Try 2: enemies 10% weaker")).toBeTruthy();
  expect(screen.queryByText("Squad wiped out")).toBeNull();
  await waitFor(() => expect(earned.length).toBe(1));
  expect(earned[0]).toBeGreaterThan(0);
});

test("the pause menu is translated into Simplified Chinese", async () => {
  fakeSdk(false, "zh-CN");
  await play();
  const start = await screen.findByRole(
    "button",
    { name: "开始" },
    { timeout: 5000 },
  );
  await act(async () => fireEvent.click(start));
  fireEvent.click(await screen.findByRole("button", { name: "暂停" }));
  expect(screen.getByRole("dialog", { name: "已暂停" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "继续" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "重开本关" })).toBeTruthy();
});

type Crowd = {
  __crowd: {
    current: {
      level: number;
      perks: { squad: number; power: number; rate: number };
      boss: { hp: number };
      coins: { taken: boolean }[];
    };
  };
};
const crowd = () => (window as unknown as Crowd).__crowd.current;

test("a level's end shows its points, and a challenge link carries them with the rules", async () => {
  const link = vi.fn(
    async () => "https://dingn.com/play/crowdrush/?c=Xq3v9TzK1bWm",
  );
  sdk.challengeLink = link;
  const roundEnded = vi.fn();
  sdk.roundEnded = roundEnded;
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  await play({ level: "3" });
  const start = await screen.findByRole(
    "button",
    { name: "Start" },
    { timeout: 5000 },
  );
  await act(async () => fireEvent.click(start));
  // Half the boss beaten, then the squad falls.
  crowd().boss.hp /= 2;
  mocks.fall = true;
  expect(
    await screen.findByText("Squad wiped out", {}, { timeout: 3000 }),
  ).toBeTruthy();
  expect(roundEnded).toHaveBeenCalledTimes(1);
  // No soldiers left, but half the boss's points.
  expect(screen.getByText("500 points")).toBeTruthy();
  expect(screen.getByText("Boss 500")).toBeTruthy();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /Challenge a friend/ })),
  );
  expect(link).toHaveBeenCalledWith({
    mode: "level",
    seed: "3",
    score: 500,
    unit: "points",
    rules: "s0p0r0.t0",
  });
  expect(writeText).toHaveBeenCalledWith(
    "Can you beat my 500 points in Crowd Rush? https://dingn.com/play/crowdrush/?c=Xq3v9TzK1bWm",
  );
  expect(screen.getByText("Link copied. Send it to a friend!")).toBeTruthy();
});

test("a friend's challenge opens their level with their upgrades, for points only", async () => {
  fakeSdk(false);
  const earn = vi.fn(async (coins: number) => ({ coins, left: 30 }));
  sdk.rewards.earn = earn;
  sdk.challenge = {
    mode: "level",
    seed: "12",
    score: 4210,
    unit: "points",
    rules: "s3p2r1.t0",
  };
  await play({ level: "2", best: "1" });
  // Straight to level 12, past the sign-in gate, with the friend's upgrades.
  expect(
    await screen.findByRole(
      "heading",
      { name: "A friend scored 4,210 points. Can you beat it?" },
      { timeout: 5000 },
    ),
  ).toBeTruthy();
  expect(crowd().level).toBe(12);
  expect(crowd().perks).toEqual({ squad: 3, power: 2, rate: 1 });
  expect(
    screen.getByText("This one is for points only: no coins or progress."),
  ).toBeTruthy();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Start" })),
  );
  // No coin packs on a points-only road.
  expect(crowd().coins.every((c) => c.taken)).toBe(true);
  mocks.fall = true;
  expect(
    await screen.findByText(
      /Your friend scored 4,210\. [\d,]+ more to beat it\./,
      {},
      { timeout: 3000 },
    ),
  ).toBeTruthy();
  expect(earn).not.toHaveBeenCalled();
  // Trying again keeps the challenge.
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Try again" })),
  );
  expect(crowd().level).toBe(12);
  expect(crowd().perks).toEqual({ squad: 3, power: 2, rate: 1 });
  // A failed challenge doesn't ease the friend's level.
  expect(screen.queryByText(/Try 2/)).toBeNull();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Start" })),
  );
  mocks.fall = true;
  await screen.findByText("Squad wiped out", {}, { timeout: 3000 });
  // Back to the player's own game: their level and upgrades.
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Back to your game" })),
  );
  expect(crowd().level).toBe(2);
  expect(crowd().perks).toEqual({ squad: 0, power: 0, rate: 0 });
  expect(screen.getByRole("heading", { name: "Ready to rush?" })).toBeTruthy();
  // Nothing was saved from the challenge.
  expect(stored.get("level")).toBe("2");
});

test("a challenge without its rules, or for another game, is ignored", async () => {
  for (const challenge of [
    { mode: "level", seed: "4", score: 10, unit: "points" as const },
    { mode: "daily", seed: "2026-11-20", score: 10, unit: "points" as const },
  ]) {
    fakeSdk(false);
    sdk.challenge = challenge;
    await play({ level: "2" });
    expect(
      await screen.findByRole(
        "heading",
        { name: "Ready to rush?" },
        { timeout: 5000 },
      ),
    ).toBeTruthy();
    expect(crowd().level).toBe(2);
    cleanup();
  }
});

test("the version shows small in a corner", async () => {
  await play();
  const { version } = await import("../game.json");
  expect(screen.getByText(`v${version}`).className).toBe("crowd-version");
});
