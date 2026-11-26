import type { Order } from "./types.ts";

/** The order's total in dollars, with tax. */
export const orderTotal = (order: Order): number => {
  const net = order.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  return Math.round(net * (1 + order.taxRate) * 100) / 100;
};
