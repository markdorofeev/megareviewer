export interface QuoteLine {
  readonly sku: string;
  readonly unitPriceCents: number;
  readonly quantity: number;
}

export interface Estimate {
  readonly lines: readonly { readonly sku: string; readonly priceCents: number }[];
  readonly totalCents: number;
}

const rateFor = (quantity: number): number => {
  if (quantity >= 500) return 0.2;
  if (quantity >= 100) return 0.15;
  if (quantity >= 20) return 0.1;
  return 0;
};

/** What an order of these lines would cost, for the quote page. */
export const estimate = (quote: readonly QuoteLine[]): Estimate => {
  const lines = quote.map(({ sku, unitPriceCents, quantity }) => ({
    sku,
    priceCents: Math.round(unitPriceCents * quantity * (1 - rateFor(quantity))),
  }));
  return { lines, totalCents: lines.reduce((sum, line) => sum + line.priceCents, 0) };
};
