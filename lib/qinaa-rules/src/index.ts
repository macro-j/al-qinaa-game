/**
 * Commercial rules shared by the browser and the trusted API server.
 *
 * Prices are stored in halalas. A council credit is consumable; purchased
 * masks are permanent. The server resolves every offer again at checkout so
 * the browser can never choose its own price or grant.
 */
export const INITIAL_COUNCIL_CREDITS = 2;

export const ROLE_ITEM_IDS = [
  "role_wizard",
  "role_madman",
  "role_avenger",
  "role_twins",
  "role_sniper",
] as const;

export const COUNCIL_PACK_ITEM_IDS = [
  "councils_5",
  "councils_15",
  "councils_40",
] as const;

export const BUNDLE_ITEM_IDS = ["roles_bundle", "full_bundle"] as const;

export const PURCHASE_ITEM_IDS = [
  ...COUNCIL_PACK_ITEM_IDS,
  ...BUNDLE_ITEM_IDS,
  ...ROLE_ITEM_IDS,
] as const;

export type RoleItemId = (typeof ROLE_ITEM_IDS)[number];
export type PurchaseItemId = (typeof PURCHASE_ITEM_IDS)[number];
export type PurchaseKind = "councils" | "role" | "roles_bundle" | "full_bundle";

export type QinaaCatalogItem = {
  id: PurchaseItemId;
  title: string;
  description: string;
  /** Base price in halalas. roles_bundle is discounted further when partially owned. */
  amount: number;
  currency: "SAR";
  kind: PurchaseKind;
  /** Retained for the retired Paylink route's compatibility. */
  requiresBaseGame: false;
};

export type QinaaOffer = QinaaCatalogItem & {
  creditsGranted: number;
  rolesGranted: RoleItemId[];
};

export const QINAA_CATALOG: Record<PurchaseItemId, QinaaCatalogItem> = {
  councils_5: {
    id: "councils_5",
    title: "القناع — 5 مجالس",
    description: "رصيد خمسة مجالس",
    amount: 1_199,
    currency: "SAR",
    kind: "councils",
    requiresBaseGame: false,
  },
  councils_15: {
    id: "councils_15",
    title: "القناع — 15 مجلسًا",
    description: "رصيد خمسة عشر مجلسًا",
    amount: 2_499,
    currency: "SAR",
    kind: "councils",
    requiresBaseGame: false,
  },
  councils_40: {
    id: "councils_40",
    title: "القناع — 40 مجلسًا",
    description: "رصيد أربعين مجلسًا",
    amount: 4_999,
    currency: "SAR",
    kind: "councils",
    requiresBaseGame: false,
  },
  roles_bundle: {
    id: "roles_bundle",
    title: "القناع — مجموعة الأقنعة",
    description: "امتلاك جميع الأقنعة الحالية مع مجالس هدية",
    amount: 4_499,
    currency: "SAR",
    kind: "roles_bundle",
    requiresBaseGame: false,
  },
  full_bundle: {
    id: "full_bundle",
    title: "القناع — الباقة الشاملة",
    description: "جميع الأقنعة الحالية و20 مجلسًا",
    amount: 5_999,
    currency: "SAR",
    kind: "full_bundle",
    requiresBaseGame: false,
  },
  role_wizard: {
    id: "role_wizard",
    title: "القناع — الساحر",
    description: "امتلاك قناع الساحر مع مجلسين هدية",
    amount: 1_199,
    currency: "SAR",
    kind: "role",
    requiresBaseGame: false,
  },
  role_madman: {
    id: "role_madman",
    title: "القناع — المجنون",
    description: "امتلاك قناع المجنون مع مجلسين هدية",
    amount: 1_199,
    currency: "SAR",
    kind: "role",
    requiresBaseGame: false,
  },
  role_avenger: {
    id: "role_avenger",
    title: "القناع — المنتقم",
    description: "امتلاك قناع المنتقم مع مجلسين هدية",
    amount: 1_199,
    currency: "SAR",
    kind: "role",
    requiresBaseGame: false,
  },
  role_twins: {
    id: "role_twins",
    title: "القناع — التوأم",
    description: "امتلاك قناع التوأم مع مجلسين هدية",
    amount: 1_199,
    currency: "SAR",
    kind: "role",
    requiresBaseGame: false,
  },
  role_sniper: {
    id: "role_sniper",
    title: "القناع — القناص",
    description: "امتلاك قناع القناص مع مجلسين هدية",
    amount: 1_199,
    currency: "SAR",
    kind: "role",
    requiresBaseGame: false,
  },
};

export const ADD_ON_ITEM_IDS = ROLE_ITEM_IDS;

export function isPurchaseItemId(value: string): value is PurchaseItemId {
  return Object.prototype.hasOwnProperty.call(QINAA_CATALOG, value);
}

export function isRoleItemId(value: string): value is RoleItemId {
  return (ROLE_ITEM_IDS as readonly string[]).includes(value);
}

/** Resolve the exact server-authoritative grant and price for this account. */
export function resolveQinaaOffer(
  itemId: PurchaseItemId,
  ownedItems: readonly string[],
): QinaaOffer | null {
  const item = QINAA_CATALOG[itemId];
  const owned = new Set(ownedItems);

  if (item.kind === "councils") {
    const creditsGranted = itemId === "councils_5" ? 5 : itemId === "councils_15" ? 15 : 40;
    return { ...item, creditsGranted, rolesGranted: [] };
  }

  if (item.kind === "role") {
    if (owned.has(itemId)) return null;
    return { ...item, creditsGranted: 2, rolesGranted: [itemId as RoleItemId] };
  }

  const missingRoles = ROLE_ITEM_IDS.filter((roleId) => !owned.has(roleId));
  if (item.kind === "roles_bundle") {
    if (missingRoles.length === 0) return null;
    const ownedCount = ROLE_ITEM_IDS.length - missingRoles.length;
    const upgradePrices = [4_499, 3_599, 2_699, 1_799, 1_199] as const;
    return {
      ...item,
      amount: upgradePrices[ownedCount],
      creditsGranted: missingRoles.length * 2,
      rolesGranted: missingRoles,
    };
  }

  // The launch bundle is intentionally a first-purchase offer. Once a mask is
  // owned, the personalised "complete the collection" offer is clearer and
  // prevents repurchasing this bundle merely as a cheap credit pack.
  if (missingRoles.length !== ROLE_ITEM_IDS.length) return null;
  return {
    ...item,
    creditsGranted: 20,
    rolesGranted: [...ROLE_ITEM_IDS],
  };
}

export function formatSarAmount(amountInHalalas: number): string {
  return (amountInHalalas / 100).toFixed(2);
}
