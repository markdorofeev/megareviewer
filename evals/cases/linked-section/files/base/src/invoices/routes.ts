import { sendError } from "../errors.ts";
import type { Router } from "../http.ts";
import { findInvoice, voidInvoice } from "./repository.ts";

export const registerInvoiceRoutes = (router: Router): void => {
  router.get("/invoices/:id", async (req, res) => {
    const invoice = await findInvoice(req.db, req.accountId, req.params.id);
    if (invoice === null) {
      sendError(res, 404, "invoice_not_found");
      return;
    }
    res.json({ invoice });
  });

  router.post("/invoices/:id/void", async (req, res) => {
    const invoice = await voidInvoice(req.db, req.accountId, req.params.id);
    if (invoice === null) {
      sendError(res, 404, "invoice_not_found");
      return;
    }
    res.json({ invoice });
  });
};
