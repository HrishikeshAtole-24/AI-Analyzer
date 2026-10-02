/** Minor units per currency (cents, paise, ...). */
const CURRENCIES: Record<string, { minorUnits: number }> = {
  USD: { minorUnits: 2 },
  EUR: { minorUnits: 2 },
  GBP: { minorUnits: 2 },
  INR: { minorUnits: 2 },
  JPY: { minorUnits: 0 },
};

/**
 * The "new currency config" that ships with the bad 1.5.0 release. It was meant to add more
 * currencies but was generated from an incomplete source, so EUR, INR and JPY are missing.
 */
const CURRENCIES_V2: Record<string, { minorUnits: number }> = {
  USD: { minorUnits: 2 },
  GBP: { minorUnits: 2 },
  CAD: { minorUnits: 2 },
  AUD: { minorUnits: 2 },
};

export function isSupportedCurrency(code: string): boolean {
  return code in CURRENCIES;
}

export function toMinorUnits(amount: number, currency: string, useV2Config: boolean): number {
  const table = useV2Config ? CURRENCIES_V2 : CURRENCIES;
  // With the v2 table, a missing currency throws a TypeError here: the real bug of the bad deploy.
  const config = table[currency] as { minorUnits: number };
  return Math.round(amount * 10 ** config.minorUnits);
}
