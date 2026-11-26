export interface Tier {
  readonly minQuantity: number;
  readonly rate: number;
}

/** Largest quantity first, so the first that fits is the one that applies. */
const TIERS: readonly Tier[] = [
  { minQuantity: 100, rate: 0.15 },
  { minQuantity: 20, rate: 0.1 },
];

/** The share taken off a line of this many units. */
export const discountRate = (quantity: number): number =>
  TIERS.find((tier) => quantity >= tier.minQuantity)?.rate ?? 0;

/** A line's price in cents after its discount. */
export const discountedLine = (unitPriceCents: number, quantity: number): number =>
  Math.round(unitPriceCents * quantity * (1 - discountRate(quantity)));
