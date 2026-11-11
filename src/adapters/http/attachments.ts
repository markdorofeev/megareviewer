import type { Hono } from "hono";
import { attachmentRoute } from "../../../contracts/index.ts";
import type { UseCases } from "../../application/use-cases/index.ts";
import { errorResponse, summarizeIssues } from "./api-routes.ts";

/** Serves an attachment from the host's store, from this origin, for `<img>` and `<video>`. */
export const registerAttachmentRoute = (app: Hono, useCases: UseCases): void => {
  app.get(attachmentRoute.path, async (c) => {
    const params = attachmentRoute.params.safeParse(c.req.param());
    const query = attachmentRoute.query.safeParse({ url: c.req.query("url") });
    if (!params.success) {
      return errorResponse(c, {
        code: "bad-request",
        message: summarizeIssues("params", params.error),
      });
    }
    if (!query.success) {
      return errorResponse(c, {
        code: "bad-request",
        message: summarizeIssues("query", query.error),
      });
    }
    const attachment = await useCases.getAttachment(params.data.id, query.data.url);
    if (!attachment.ok) return errorResponse(c, attachment.error);
    const { contentType, bytes } = attachment.value;
    return c.body(bytes.slice().buffer, 200, {
      "content-type": contentType,
      "content-length": String(bytes.byteLength),
      "content-disposition": "inline",
      // An attachment's URL names its content; the page asks again after an hour at most.
      "cache-control": "private, max-age=3600",
    });
  });
};
