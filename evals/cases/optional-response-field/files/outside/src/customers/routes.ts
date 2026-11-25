import { Router } from "express";
import { customerView } from "./customer-view.ts";
import type { CustomerRepository } from "./store.ts";

export const customerRoutes = (customers: CustomerRepository): Router => {
  const router = Router();

  router.get("/customers/:id", async (request, response) => {
    const customer = await customers.find(request.params.id, request.tenantId);
    if (customer === null) return response.status(404).json({ error: "customer_not_found" });
    return response.json(customerView(customer));
  });

  return router;
};
