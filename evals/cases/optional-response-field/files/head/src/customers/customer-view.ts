import type { Customer } from "./repository.ts";

/** What the API says of a customer. */
export interface CustomerView {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  /** Absent when the customer has never ordered. */
  readonly lastOrderAt?: string;
}

export const customerView = (customer: Customer): CustomerView => ({
  id: customer.id,
  name: customer.name,
  email: customer.email,
  ...(customer.lastOrderAt === null ? {} : { lastOrderAt: customer.lastOrderAt.toISOString() }),
});
