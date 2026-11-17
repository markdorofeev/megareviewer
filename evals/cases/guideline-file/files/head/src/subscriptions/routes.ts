import { sendError } from "../errors.ts";
import type { Router } from "../http.ts";
import { findSubscription, pauseSubscription } from "./repository.ts";

export const registerSubscriptionRoutes = (router: Router): void => {
  router.get("/subscriptions/:id", async (req, res) => {
    const subscription = await findSubscription(req.db, req.accountId, req.params.id);
    if (subscription === null) {
      sendError(res, 404, "subscription_not_found");
      return;
    }
    res.json({ subscription });
  });

  router.post("/subscriptions/:id/pause", async (req, res) => {
    const subscription = await pauseSubscription(req.db, req.accountId, req.params.id);
    if (subscription === null) {
      sendError(res, 404, "subscription_not_found");
      return;
    }
    res.json({ subscription });
  });
};
