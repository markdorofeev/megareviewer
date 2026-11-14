import { describe, expect, it } from "vitest";
import { err, ok } from "../shared/index.ts";
import { type PullRequestRef, parsePullRequestUrl, pullRequestUrl } from "./index.ts";

const github = (owner: string, repo: string, number: number): PullRequestRef => ({
  repo: { host: "github", owner, repo },
  number,
});
const bitbucket = (owner: string, repo: string, number: number): PullRequestRef => ({
  repo: { host: "bitbucket", owner, repo },
  number,
});

describe("parsePullRequestUrl", () => {
  it.each([
    ["https://github.com/acme/shop/pull/101", github("acme", "shop", 101)],
    ["https://github.com/acme/shop/pull/101/", github("acme", "shop", 101)],
    ["https://github.com/acme/shop/pull/101/files", github("acme", "shop", 101)],
    ["https://github.com/acme/shop/pull/101/commits/abc", github("acme", "shop", 101)],
    ["https://github.com/acme/shop/pull/101?w=1", github("acme", "shop", 101)],
    ["https://github.com/acme/shop/pull/101#discussion_r1", github("acme", "shop", 101)],
    ["https://GitHub.COM/acme/shop/pull/101", github("acme", "shop", 101)],
    ["https://github.com/Acme/My.Shop_2-x/pull/7", github("acme", "my.shop_2-x", 7)],
    ["  https://github.com/acme/shop/pull/101\n", github("acme", "shop", 101)],
    ["https://github.com:443/acme/shop/pull/101", github("acme", "shop", 101)],
    ["https://bitbucket.org/acme/payments/pull-requests/42", bitbucket("acme", "payments", 42)],
    [
      "https://bitbucket.org/acme/payments/pull-requests/42/diff",
      bitbucket("acme", "payments", 42),
    ],
    [
      "https://Bitbucket.org/acme/payments/pull-requests/42/overview?x=1#y",
      bitbucket("acme", "payments", 42),
    ],
    ["github.com/acme/shop/pull/101", github("acme", "shop", 101)],
    ["  GitHub.com/acme/shop/pull/101/files", github("acme", "shop", 101)],
    ["bitbucket.org/acme/payments/pull-requests/42", bitbucket("acme", "payments", 42)],
  ])("accepts %s", (url, expected) => {
    expect(parsePullRequestUrl(url)).toEqual(ok(expected));
  });

  it.each([
    ["not a url"],
    [""],
    ["github.com:8443/acme/shop/pull/1"],
    ["www.github.com/acme/shop/pull/1"],
    ["github.com.evil.com/acme/shop/pull/1"],
    ["http://github.com/acme/shop/pull/1"],
    ["ftp://github.com/acme/shop/pull/1"],
    ["https://github.com:8443/acme/shop/pull/1"],
    ["https://user:pass@github.com/acme/shop/pull/1"],
    ["https://www.github.com/acme/shop/pull/1"],
    ["https://github.example.com/acme/shop/pull/1"],
    ["https://bitbucket.example.com/projects/ACME/repos/pay/pull-requests/1"],
    ["https://evil.com/github.com/acme/shop/pull/1"],
    ["https://github.com/acme/shop/pulls/1"],
    ["https://github.com/acme/shop/pull-requests/1"],
    ["https://bitbucket.org/acme/payments/pull/42"],
    ["https://github.com/acme/shop/pull/"],
    ["https://github.com/acme/shop/pull/0"],
    ["https://github.com/acme/shop/pull/01"],
    ["https://github.com/acme/shop/pull/-1"],
    ["https://github.com/acme/shop/pull/1.5"],
    ["https://github.com/acme/shop/pull/12abc"],
    ["https://github.com/acme/shop/pull/99999999999999999999"],
    ["https://github.com/acme/shop"],
    ["https://github.com/acme//pull/1"],
    ["https://github.com/acme/sh%20op/pull/1"],
    ["https://github.com/acme/../pull/1"],
  ])("rejects %j", (url) => {
    expect(parsePullRequestUrl(url)).toEqual(err("unsupported-url"));
  });
});

describe("pullRequestUrl", () => {
  it.each([
    [github("acme", "shop", 101), "https://github.com/acme/shop/pull/101"],
    [bitbucket("acme", "payments", 42), "https://bitbucket.org/acme/payments/pull-requests/42"],
  ])("builds the canonical URL for %j", (ref, url) => {
    expect(pullRequestUrl(ref)).toBe(url);
  });

  it("round-trips through parsePullRequestUrl", () => {
    for (const ref of [github("acme", "shop", 101), bitbucket("acme", "payments", 42)]) {
      expect(parsePullRequestUrl(pullRequestUrl(ref))).toEqual(ok(ref));
    }
  });
});
