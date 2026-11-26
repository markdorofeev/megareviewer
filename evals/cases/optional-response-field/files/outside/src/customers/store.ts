import type { Customer } from "./repository.ts";

export interface CustomerRepository {
  find(id: string, tenantId: string): Promise<Customer | null>;
}
