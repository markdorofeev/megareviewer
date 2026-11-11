import { describe, expect, it } from "vitest";
import { attachmentHost } from "./attachments.ts";

describe("attachmentHost", () => {
  it.each([
    ["https://github.com/user-attachments/assets/771a3d24-9ce2-4554-96da-50a773965ff5", "github"],
    ["https://user-images.githubusercontent.com/1/abc.png", "github"],
    ["https://private-user-images.githubusercontent.com/1/abc.png?jwt=x", "github"],
    ["https://bitbucket.org/acme/shop/images/1234-shot.png", "bitbucket"],
    ["https://bitbucket.org/acme/shop/raw/51b7da02ca1b/docs/shot.png", "bitbucket"],
  ] as const)("knows %s is %s's", (url, host) => {
    expect(attachmentHost(url)).toBe(host);
  });

  it.each([
    "http://github.com/user-attachments/assets/771a3d24",
    "https://github.com/user-attachments/files/123/report.zip",
    "https://github.com/user-attachments/assets/../../login",
    "https://github.com.evil.test/user-attachments/assets/771a3d24",
    "https://user@github.com/user-attachments/assets/771a3d24",
    "https://github.com:8443/user-attachments/assets/771a3d24",
    "https://user-images.githubusercontent.com/",
    "https://bitbucket.org/acme/shop/src/main/a.png",
    "https://bitbucket.org/acme/shop/raw/51b7da02ca1b",
    "https://bitbucket.org/acme/shop/raw/51b7da02ca1b/",
    "https://evil.test/a.png",
    "not a url",
  ])("fetches nothing from %s", (url) => {
    expect(attachmentHost(url)).toBeNull();
  });
});
