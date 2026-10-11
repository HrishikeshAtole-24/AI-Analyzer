/**
 * Order pricing. Release 2.2.0 (the order-service bad_deploy fault) introduced per-SKU discounts
 * from a table generated off an old catalog export, so a newer SKU is missing and reading its
 * entry throws a TypeError: a real bug that only hits orders containing that SKU.
 */

const DISCOUNTS_V2: Record<string, { percent: number }> = {
  'SKU-KEYBOARD': { percent: 5 },
  'SKU-MOUSE': { percent: 0 },
  'SKU-MONITOR': { percent: 10 },
  'SKU-CABLE': { percent: 0 },
  'SKU-HEADSET': { percent: 5 },
  // SKU-WEBCAM is missing: it was added to the catalog after the export.
};

export interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
}

export function orderTotal(items: LineItem[], withDiscounts: boolean): number {
  const total = items.reduce((sum, item) => {
    const line = item.quantity * item.unitPrice;
    if (!withDiscounts) return sum + line;
    const discount = (DISCOUNTS_V2[item.sku] as { percent: number }).percent;
    return sum + line * (1 - discount / 100);
  }, 0);
  return Math.round(total * 100) / 100;
}
