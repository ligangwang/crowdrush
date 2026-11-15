// Crowd Rush's permanent upgrades, bought with dingn coins. They are listed
// in game.json's "shop" (dingn checks prices and asks the player to confirm);
// this file says what the player owns and what to buy next.
import type { DingnGame, ShopItem } from "../sdk/dingn-sdk.js";
import { MAX_TIER, NO_PERKS, TIER_UNLOCK, type Perks } from "./crowd-core";

export type UpgradeKind = keyof Perks;
export const UPGRADE_KINDS: UpgradeKind[] = ["squad", "power", "rate"];
export const TIERS = MAX_TIER;
/** What each tier costs, matching game.json (dingn caps a price at 1,000). */
export const PRICES = [50, 120, 250, 400, 500, 600, 700, 800, 900, 1000];
export const upgradeId = (kind: UpgradeKind, tier: number) => `${kind}-${tier}`;

/** The tiers owned of each upgrade, from dingn's list of the shop. */
export function perksFrom(shop: ShopItem[]): Perks {
  const owned = new Set(shop.filter((i) => i.owned).map((i) => i.id));
  const tiers = (kind: UpgradeKind) => {
    let n = 0;
    while (n < TIERS && owned.has(upgradeId(kind, n + 1))) n++;
    return n;
  };
  return { power: tiers("power"), rate: tiers("rate"), squad: tiers("squad") };
}

/**
 * The next tier to buy, or null when an upgrade is maxed out. A tier the
 * player hasn't reached the level for yet says where it unlocks (`unlocks`).
 */
export function nextUpgrade(kind: UpgradeKind, perks: Perks, level = 1) {
  const tier = perks[kind] + 1;
  if (tier > TIERS) return null;
  const at = TIER_UNLOCK[tier - 1];
  return {
    id: upgradeId(kind, tier),
    tier,
    price: PRICES[tier - 1],
    unlocks: at > level ? at : null,
  };
}

type Shop = Pick<DingnGame, "player"> & {
  rewards: Pick<DingnGame["rewards"], "spend" | "shop">;
};

/** The player's upgrades; none when signed out or dingn can't say. */
export async function loadPerks(sdk: Shop): Promise<Perks> {
  if (!sdk.player.signedIn) return { ...NO_PERKS };
  try {
    return perksFrom(await sdk.rewards.shop());
  } catch {
    return { ...NO_PERKS };
  }
}

export type BuyResult = "bought" | "cancelled" | "poor" | "failed";

/** Buys the next tier of an upgrade. dingn asks the player first. */
export async function buyUpgrade(sdk: Shop, id: string): Promise<BuyResult> {
  try {
    await sdk.rewards.spend(id);
    return "bought";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "cancelled") return "cancelled";
    if (code === "not_enough_coins") return "poor";
    console.warn("Crowd Rush upgrade", id, err);
    return "failed";
  }
}
