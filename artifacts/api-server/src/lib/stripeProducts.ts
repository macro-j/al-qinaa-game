import type Stripe from "stripe";

/**
 * The single "All-Access" product the test checkout sells. Resolved (and lazily
 * created) in Stripe via a stable lookup_key so this is idempotent across
 * restarts and never duplicates products/prices.
 */
const ALL_ACCESS_LOOKUP_KEY = "qinaa_all_access";
const ALL_ACCESS_AMOUNT = 2999; // 29.99 SAR, in the currency's minor unit
const ALL_ACCESS_CURRENCY = "sar";

let cachedPriceId: string | null = null;

export async function getAllAccessPriceId(stripe: Stripe): Promise<string> {
  if (cachedPriceId) return cachedPriceId;

  const existing = await stripe.prices.list({
    lookup_keys: [ALL_ACCESS_LOOKUP_KEY],
    active: true,
    limit: 1,
  });
  if (existing.data.length > 0 && existing.data[0]) {
    cachedPriceId = existing.data[0].id;
    return cachedPriceId;
  }

  const product = await stripe.products.create({
    name: "قناع — الباقة الشاملة (All-Access)",
    description: "كل الأدوار الحالية والمستقبلية + إزالة الإعلانات",
    metadata: { qinaa_package: "all_access" },
  });

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: ALL_ACCESS_AMOUNT,
    currency: ALL_ACCESS_CURRENCY,
    lookup_key: ALL_ACCESS_LOOKUP_KEY,
    metadata: { qinaa_package: "all_access" },
  });

  cachedPriceId = price.id;
  return cachedPriceId;
}
