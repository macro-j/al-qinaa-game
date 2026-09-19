import {
  QINAA_CATALOG,
  type QinaaCatalogItem,
} from "@workspace/qinaa-rules";

export type PaylinkCatalogItem = QinaaCatalogItem;
export const PAYLINK_CATALOG = QINAA_CATALOG;

export function getPaylinkCatalogItem(itemId: string): PaylinkCatalogItem | null {
  return Object.prototype.hasOwnProperty.call(PAYLINK_CATALOG, itemId)
    ? PAYLINK_CATALOG[itemId as keyof typeof PAYLINK_CATALOG]
    : null;
}

export function amountToSar(amount: number): number {
  return amount / 100;
}

export function amountToHalalas(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100);
}
