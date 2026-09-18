export type PaylinkCatalogItem = {
  id: string;
  title: string;
  description: string;
  /** Price in halalas. Paylink receives the converted SAR value. */
  amount: number;
  currency: "SAR";
  requiresBaseGame: boolean;
};

export const PAYLINK_CATALOG: Record<string, PaylinkCatalogItem> = {
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

export function getPaylinkCatalogItem(
  itemId: string,
): PaylinkCatalogItem | null {
  return Object.prototype.hasOwnProperty.call(PAYLINK_CATALOG, itemId)
    ? PAYLINK_CATALOG[itemId]!
    : null;
}

export function amountToSar(amount: number): number {
  return amount / 100;
}

export function amountToHalalas(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100);
}
