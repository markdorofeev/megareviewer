import type { HostKind } from "./pull-request.ts";

/**
 * The host whose own attachment store `url` is in: where GitHub and Bitbucket keep what's pasted
 * or dropped into a comment. Only these are fetched, with the reviewer's credentials; any other
 * URL in a body is a PR author's choice, and fetching it would tell them who's reviewing.
 */
export const attachmentHost = (url: string): HostKind | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.port !== "") return null;
  const { hostname, pathname } = parsed;
  if (hostname === "github.com" && /^\/user-attachments\/assets\/[0-9a-f-]+$/i.test(pathname)) {
    return "github";
  }
  if (
    (hostname === "user-images.githubusercontent.com" ||
      hostname === "private-user-images.githubusercontent.com") &&
    pathname.length > 1
  ) {
    return "github";
  }
  if (hostname === "bitbucket.org" && /^\/[^/]+\/[^/]+\/images\/[^/]+$/.test(pathname)) {
    return "bitbucket";
  }
  return null;
};
