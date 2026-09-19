/**
 * Commercial rules shared by the browser and the trusted API server.
 *
 * Prices are stored in halalas so checkout never relies on floating-point
 * arithmetic. Keeping this catalog in one workspace package prevents the
 * storefront copy from drifting away from the server-authoritative charge.
 */
export const FREE_GAME_LIMIT = 2;

export const PURCHASE_ITEM_IDS = [
  "base_game",
  "all_access",
  "role_wizard",
  "role_madman",
  "role_avenger",
  "role_twins",
  "role_sniper",
] as const;

export type PurchaseItemId = (typeof PURCHASE_ITEM_IDS)[number];

export type QinaaCatalogItem = {
  id: PurchaseItemId;
  title: string;
  description: string;
  /** Price in halalas. */
  amount: number;
  currency: "SAR";
  requiresBaseGame: boolean;
};

export const QINAA_CATALOG: Record<PurchaseItemId, QinaaCatalogItem> = {
  base_game: {
    id: "base_game",
    title: "القناع — اللعبة الأساسية",
    description: "وصول دائم إلى اللعبة الأساسية",
    amount: 1_499,
    currency: "SAR",
    requiresBaseGame: false,
  },
  all_access: {
    id: "all_access",
    title: "القناع — الباقة الشاملة",
    description: "وصول دائم إلى اللعبة وجميع الأدوار الإضافية",
    amount: 2_999,
    currency: "SAR",
    requiresBaseGame: false,
  },
  role_wizard: {
    id: "role_wizard",
    title: "القناع — دور الساحر",
    description: "فتح دور الساحر الإضافي",
    amount: 799,
    currency: "SAR",
    requiresBaseGame: true,
  },
  role_madman: {
    id: "role_madman",
    title: "القناع — دور المجنون",
    description: "فتح دور المجنون الإضافي",
    amount: 799,
    currency: "SAR",
    requiresBaseGame: true,
  },
  role_avenger: {
    id: "role_avenger",
    title: "القناع — دور المنتقم",
    description: "فتح دور المنتقم الإضافي",
    amount: 799,
    currency: "SAR",
    requiresBaseGame: true,
  },
  role_twins: {
    id: "role_twins",
    title: "القناع — دور التوأم",
    description: "فتح دور التوأم الإضافي",
    amount: 799,
    currency: "SAR",
    requiresBaseGame: true,
  },
  role_sniper: {
    id: "role_sniper",
    title: "القناع — دور القناص",
    description: "فتح دور القناص الإضافي",
    amount: 799,
    currency: "SAR",
    requiresBaseGame: true,
  },
};

export const ADD_ON_ITEM_IDS = PURCHASE_ITEM_IDS.filter(
  (itemId): itemId is Exclude<PurchaseItemId, "base_game" | "all_access"> =>
    itemId.startsWith("role_"),
);

export function formatSarAmount(amountInHalalas: number): string {
  return (amountInHalalas / 100).toFixed(2);
}
