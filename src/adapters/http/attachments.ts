import type { Hono } from "hono";
import { attachmentRoute } from "../../../contracts/index.ts";
import type { UseCases } from "../../application/use-cases/index.ts";
import { errorResponse, summarizeIssues } from "./api-routes.ts";

/**
 * The bytes a `Range` header asks for, as [first, last] inclusive; null for the whole file, and
 * "unsatisfiable" for a range the file doesn't have. Only one range is served, as video players
 * ask for.
 */
export const byteRange = (
  header: string | undefined,
  size: number,
): readonly [number, number] | null | "unsatisfiable" => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (match === null) return null;
  const [, from = "", to = ""] = match;
  if (from === "" && to === "") return null;
  if (from === "") {
    // The last `to` bytes.
    const length = Number(to);
    return length === 0 || size === 0 ? "unsatisfiable" : [Math.max(0, size - length), size - 1];
  }
  const first = Number(from);
  const last = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  return first >= size || last < first ? "unsatisfiable" : [first, last];
};

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
    const headers = {
      "content-type": contentType,
      "content-disposition": "inline",
      // An attachment's URL names its content; the page asks again after an hour at most.
      "cache-control": "private, max-age=3600",
      // A video player seeks by asking for the bytes at the new time.
      "accept-ranges": "bytes",
    };
    const range = byteRange(c.req.header("range"), bytes.byteLength);
    if (range === "unsatisfiable") {
      return c.body(null, 416, { ...headers, "content-range": `bytes */${bytes.byteLength}` });
    }
    if (range === null) {
      return c.body(bytes.slice().buffer, 200, {
        ...headers,
        "content-length": String(bytes.byteLength),
      });
    }
    const [first, last] = range;
    return c.body(bytes.slice(first, last + 1).buffer, 206, {
      ...headers,
      "content-length": String(last - first + 1),
      "content-range": `bytes ${first}-${last}/${bytes.byteLength}`,
    });
  });
};
