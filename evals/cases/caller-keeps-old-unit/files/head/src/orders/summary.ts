import { orderTotal } from "./total.ts";
import type { Order } from "./types.ts";

export interface OrderSummary {
  readonly id: string;
  readonly total: string;
}

export const orderSummary = (order: Order): OrderSummary => ({
  id: order.id,
  total: `$${(orderTotal(order) / 100).toFixed(2)}`,
});
