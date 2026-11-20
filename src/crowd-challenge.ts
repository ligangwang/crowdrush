// Challenge links: after a level, a player can send a friend a link to the
// same level with their points to beat. dingn saves the challenge and makes
// the link and its preview ("Ada reached 4,210 points in Crowd Rush. Can you
// beat it?"); following it opens Crowd Rush on that level.
//
// Every level is laid out the same for everyone (newLevel is seeded), but it
// is sized for the player's upgrades, eased after failed tries, and its coin
// packs (which soak up gunfire) are cleared once a player's daily coins are
// in. So a challenge also carries the rules it was played with: the upgrade
// tiers, the tries and whether the coin packs were on the road. The friend
// plays the level under exactly those rules, whatever they own themselves,
// so the two scores are fair to compare.
import type { Challenge } from "../sdk/dingn-sdk.js";
import { MAX_TIER, NO_PERKS, type Perks } from "./crowd-core";

/**
 * The upgrade tiers a level was played with, how many tries had eased it
 * (at most MAX_TRIES, where the easing stops), and whether its coin packs
 * were on the road.
 */
export type Rules = { perks: Perks; tries: number; packs: boolean };
/** Tries ease a level up to the fifth (retryEase). */
export const MAX_TRIES = 5;
/** The highest level a challenge can name. */
export const MAX_LEVEL = 9999;

/**
 * A level, the points to beat on it, and the rules it was played with.
 * `mine` marks the player's own challenge, opened by them: their own score
 * to beat.
 */
export type Round = {
  level: number;
  score: number;
  rules: Rules;
  mine?: boolean;
};

/**
 * Rules as dingn keeps them: "s", "p" and "r" tiers, the tries and the coin
 * packs (1 on the road, 0 cleared), e.g. "s3p2r1.t0.c1".
 */
export const writeRules = (r: Rules) =>
  `s${r.perks.squad}p${r.perks.power}r${r.perks.rate}.t${Math.min(r.tries, MAX_TRIES)}.c${r.packs ? 1 : 0}`;

/** Rules written by writeRules, or null for anything else. */
export function readRules(text: string | undefined): Rules | null {
  const m = /^s(\d{1,2})p(\d{1,2})r(\d{1,2})\.t(\d)\.c([01])$/.exec(text ?? "");
  if (!m) return null;
  const [squad, power, rate, tries, packs] = m.slice(1).map(Number);
  if ([squad, power, rate].some((t) => t > MAX_TIER) || tries > MAX_TRIES)
    return null;
  return {
    perks: { ...NO_PERKS, squad, power, rate },
    tries,
    packs: packs === 1,
  };
}

/**
 * The round a friend's challenge asks for, or null for one Crowd Rush does
 * not know (another game's, a malformed one, or one without its rules).
 */
export function readChallenge(c: Challenge | null | undefined): Round | null {
  if (!c || c.mode !== "level" || c.unit !== "points") return null;
  if (!Number.isInteger(c.score) || c.score < 0) return null;
  if (!c.seed || !/^\d{1,4}$/.test(c.seed)) return null;
  const level = Number(c.seed);
  const rules = readRules(c.rules);
  if (level < 1 || level > MAX_LEVEL || !rules) return null;
  return { level, score: c.score, rules, ...(c.mine ? { mine: true } : {}) };
}

/** The challenge for a level just played, to make a link with. */
export const challengeFor = (round: Round): Challenge => ({
  mode: "level",
  seed: String(round.level),
  score: round.score,
  unit: "points",
  rules: writeRules(round.rules),
});

/**
 * Whether a challenge's rules give more than the player has: a higher
 * upgrade tier than they own, or a level eased by tries they didn't make.
 */
export const beyond = (rules: Rules, own: Perks) =>
  rules.tries > 0 ||
  (["squad", "power", "rate"] as const).some((k) => rules.perks[k] > own[k]);

/**
 * Shares a challenge link: the phone's share sheet where there is one,
 * otherwise the clipboard. Says which happened, or "failed" when neither
 * worked, so the game can show the link to copy by hand.
 */
export async function shareLink(
  url: string,
  text: string,
): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function"
  ) {
    try {
      await navigator.share({ title: "Crowd Rush", text, url });
      return "shared";
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return "cancelled";
      // Not allowed here: fall back to copying.
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    return "copied";
  } catch {
    return "failed";
  }
}
