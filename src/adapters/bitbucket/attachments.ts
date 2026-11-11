import { type Attachment, MAX_ATTACHMENT_BYTES } from "../../application/ports/index.ts";
import { attachmentHost, type HostError, type HostErrorKind } from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";

const MAX_REDIRECTS = 5;
/** Only these come back to the page; an SVG is left out, as it can carry scripts. */
const MEDIA = /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm|quicktime))$/;

const hostError = (kind: HostErrorKind, message: string): HostError => ({
  kind,
  message,
  retryAfterSeconds: null,
});

const STATUS: Readonly<Record<number, HostErrorKind>> = {
  401: "unauthorized",
  403: "forbidden",
  404: "not-found",
};

/**
 * An attachment from Bitbucket's own store. The credentials go to bitbucket.org only; a
 * redirect elsewhere, as to a CDN, is followed without them.
 */
export const fetchAttachment = async (
  url: string,
  options: {
    /** The Basic auth header, as the API client sends it. */
    readonly authorization: string;
    readonly userAgent: string;
    readonly fetch: typeof fetch;
    readonly timeoutMs: number;
  },
): Promise<Result<Attachment, HostError>> => {
  if (attachmentHost(url) !== "bitbucket") {
    return err(hostError("not-found", "Not one of Bitbucket's attachments"));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let target = url;
    let response: Response;
    for (let hop = 0; ; hop += 1) {
      const toBitbucket = new URL(target).origin === "https://bitbucket.org";
      response = await options.fetch(target, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": options.userAgent,
          ...(toBitbucket ? { authorization: options.authorization } : {}),
        },
      });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || location === null) break;
      if (hop === MAX_REDIRECTS) return err(hostError("unexpected", "Too many redirects"));
      await response.body?.cancel();
      target = new URL(location, target).href;
      if (new URL(target).protocol !== "https:") {
        return err(hostError("unexpected", "Bitbucket redirected an attachment off HTTPS"));
      }
    }
    if (!response.ok) {
      await response.body?.cancel();
      return err(
        hostError(
          STATUS[response.status] ?? "unexpected",
          `Bitbucket answered ${response.status} for an attachment`,
        ),
      );
    }
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    if (!MEDIA.test(contentType)) {
      await response.body?.cancel();
      return err(
        hostError(
          "rejected",
          `The attachment is ${contentType || "of no type"}, not an image or a video`,
        ),
      );
    }
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > MAX_ATTACHMENT_BYTES) {
      await response.body?.cancel();
      return err(hostError("too-large", "The attachment is over 25 MB"));
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      return err(hostError("too-large", "The attachment is over 25 MB"));
    }
    return ok({ contentType, bytes });
  } catch (error) {
    if (controller.signal.aborted) {
      return err(
        hostError(
          "network",
          `Bitbucket didn't send the attachment within ${options.timeoutMs / 1000} seconds`,
        ),
      );
    }
    if (error instanceof TypeError)
      return err(hostError("network", `Can't reach Bitbucket: ${error.message}`));
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
