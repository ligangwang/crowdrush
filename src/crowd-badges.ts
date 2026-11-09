// Crowd Rush's dingn badges. They are declared in game.json (dingn checks that
// list and decides what each tier pays); this file says when they are earned.
import type { DingnGame } from "../sdk/dingn-sdk.js";

export type Tier = "bronze" | "silver" | "gold" | "diamond";

/** A level badge every 5 levels up to 100, rising through the tiers. */
export const LEVEL_MILESTONES = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
export const tierFor = (level: number): Tier =>
  level >= 80 ? "diamond" : level >= 50 ? "gold" : level >= 25 ? "silver" : "bronze";
export const levelBadge = (level: number) => `level-${level}`;
export const FIRST_WIN = "first-win";
export const THREE_STARS = "three-stars";

/** Every badge a cleared level qualifies for, including earlier milestones. */
export function badgesFor(level: number, stars: number) {
  return [
    FIRST_WIN,
    ...(stars >= 3 ? [THREE_STARS] : []),
    ...LEVEL_MILESTONES.filter((m) => m <= level).map(levelBadge),
  ];
}

type Badged = Pick<DingnGame, "rewards" | "player">;

/**
 * Unlocks the badges a cleared level earned, skipping ones the player already
 * has, so a win sends at most a few requests. dingn shows the popups and pays
 * the coins. Never throws: badges must not get in the way of the game.
 */
export function createBadgeTracker() {
  let earned: Promise<Set<string>> | null = null;
  const known = (sdk: Badged) =>
    (earned ??= sdk.rewards
      .list()
      .then((all) => new Set(all.filter((b) => b.earned).map((b) => b.id)))
      .catch(() => new Set<string>()));
  return {
    /** Forget what was earned, for example after the player signs in. */
    reset() {
      earned = null;
    },
    async cleared(sdk: Badged, level: number, stars: number) {
      if (!sdk.player.signedIn) return [];
      const have = await known(sdk);
      const unlocked: string[] = [];
      for (const id of badgesFor(level, stars)) {
        if (have.has(id)) continue;
        try {
          await sdk.rewards.unlock(id);
          have.add(id);
          unlocked.push(id);
        } catch (err) {
          console.warn("Crowd Rush badge", id, err);
          // signed out, offline or an older dingn: try again next win
          break;
        }
      }
      return unlocked;
    },
  };
}
