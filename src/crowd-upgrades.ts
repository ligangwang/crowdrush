// Crowd Rush's permanent upgrades, bought with dingn coins. They are listed
// in game.json's "shop" (dingn checks prices and asks the player to confirm);
// this file says what the player owns and what to buy next.
import type { DingnGame, ShopItem } from "../sdk/dingn-sdk.js";
import type { Perks } from "./crowd-core";

export type UpgradeKind = keyof Perks;
export const UPGRADE_KINDS: UpgradeKind[] = ["power", "rate"];
export const TIERS = 3;
/** What each tier costs, matching game.json. */
export const PRICES = [50, 120, 250];
export const upgradeId = (kind: UpgradeKind, tier: number) => `${kind}-${tier}`;

/** The tiers owned of each upgrade, from dingn's list of the shop. */
export function perksFrom(shop: ShopItem[]): Perks {
  const owned = new Set(shop.filter((i) => i.owned).map((i) => i.id));
  const tiers = (kind: UpgradeKind) => {
    let n = 0;
    while (n < TIERS && owned.has(upgradeId(kind, n + 1))) n++;
    return n;
  };
  return { power: tiers("power"), rate: tiers("rate") };
}

/** The next tier to buy, or null when an upgrade is maxed out. */
export function nextUpgrade(kind: UpgradeKind, perks: Perks) {
  const tier = perks[kind] + 1;
  return tier > TIERS
    ? null
    : { id: upgradeId(kind, tier), tier, price: PRICES[tier - 1] };
}

type Shop = Pick<DingnGame, "player"> & {
  rewards: Pick<DingnGame["rewards"], "spend" | "shop">;
};

/** The player's upgrades; none when signed out or dingn can't say. */
export async function loadPerks(sdk: Shop): Promise<Perks> {
  if (!sdk.player.signedIn) return { power: 0, rate: 0 };
  try {
    return perksFrom(await sdk.rewards.shop());
  } catch {
    return { power: 0, rate: 0 };
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
