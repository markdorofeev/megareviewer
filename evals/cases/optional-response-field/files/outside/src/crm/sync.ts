import { customerView } from "../customers/customer-view.ts";
import type { Customer } from "../customers/repository.ts";
import type { CrmClient } from "./client.ts";

/** Sends a customer's name and email to the CRM. */
export const syncCustomer = async (crm: CrmClient, customer: Customer): Promise<void> => {
  const { id, name, email } = customerView(customer);
  await crm.upsert({ externalId: id, name, email });
};
