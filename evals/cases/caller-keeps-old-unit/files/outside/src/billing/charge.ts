import { orderTotal } from "../orders/total.ts";
import type { Order } from "../orders/types.ts";
import type { PaymentClient } from "./client.ts";

/** Charges the card on file. The payment provider takes amounts in cents. */
export const chargeOrder = async (client: PaymentClient, order: Order): Promise<string> => {
  const amount = Math.round(orderTotal(order) * 100);
  const charge = await client.charges.create({ amount, currency: "usd", orderId: order.id });
  return charge.id;
};
