/**
 * Server-side catalog of purchasable items. This is the SINGLE source of truth
 * for pricing — the client only sends an `itemId`; it never gets to dictate the
 * amount charged. Each Checkout Session is built dynamically from this catalog
 * via Stripe `price_data` (no pre-created Products/Prices needed).
 *
 * `itemId` values are also written into the session metadata and used by the
 * fulfillment RPC to unlock exactly the purchased item.
 */
export type CatalogItem = {
  id: string;
  /** Name shown on the Stripe-hosted Checkout page. */
  name: string;
  /** Price in the currency's minor unit (halalas for SAR; 14.99 SAR = 1499). */
  amount: number;
  currency: string;
};

export const CATALOG: Record<string, CatalogItem> = {
  base_game: {
    id: "base_game",
    name: "قناع — اللعبة الأساسية",
    amount: 1499,
    currency: "sar",
  },
  all_access: {
    id: "all_access",
    name: "قناع — الباقة الشاملة",
    amount: 2999,
    currency: "sar",
  },
  role_wizard: {
    id: "role_wizard",
    name: "قناع — دور الساحر",
    amount: 799,
    currency: "sar",
  },
  role_madman: {
    id: "role_madman",
    name: "قناع — دور المجنون",
    amount: 799,
    currency: "sar",
  },
  role_avenger: {
    id: "role_avenger",
    name: "قناع — دور المنتقم",
    amount: 799,
    currency: "sar",
  },
  role_twins: {
    id: "role_twins",
    name: "قناع — دور التوأم",
    amount: 799,
    currency: "sar",
  },
};

/** Returns the catalog item for an id, or null if the id is unknown. */
export function getCatalogItem(itemId: string): CatalogItem | null {
  return Object.prototype.hasOwnProperty.call(CATALOG, itemId)
    ? CATALOG[itemId]!
    : null;
}
