import { describe, expect, it } from "vitest";
import { repoOfRemote, reposOfConfig, reposOfRemotes } from "./remotes.ts";

describe("repoOfRemote", () => {
  it.each([
    ["git@github.com:acme/shop.git", "github"],
    ["github.com:acme/shop", "github"],
    ["ssh://git@github.com/acme/shop.git", "github"],
    ["ssh://git@github.com:22/acme/shop", "github"],
    ["https://github.com/acme/shop.git", "github"],
    ["https://github.com/acme/shop/", "github"],
    ["https://token@github.com/Acme/Shop", "github"],
    ["git://github.com/acme/shop.git", "github"],
    ["git@bitbucket.org:acme/shop.git", "bitbucket"],
    ["https://someone@bitbucket.org/acme/shop.git", "bitbucket"],
  ])("reads %s", (url, host) => {
    expect(repoOfRemote(url)).toEqual({ host, owner: "acme", repo: "shop" });
  });

  it.each([
    "https://gitlab.com/acme/shop.git",
    "git@work-github:acme/shop.git",
    "https://github.com/acme",
    "https://github.com/acme/shop/tree/main",
    "/srv/git/shop.git",
    "../shop",
    "file:///srv/git/shop.git",
  ])("reads no repository from %s", (url) => {
    expect(repoOfRemote(url)).toBeNull();
  });
});

describe("reposOfRemotes", () => {
  it("reads each repository once, from `git remote -v`", () => {
    const output = [
      "origin\tgit@github.com:acme/shop.git (fetch)",
      "origin\tgit@github.com:acme/shop.git (push)",
      "fork\thttps://github.com/me/shop.git (fetch)",
      "local\t/srv/shop (fetch)",
      "",
    ].join("\n");
    expect(reposOfRemotes(output)).toEqual([
      { host: "github", owner: "acme", repo: "shop" },
      { host: "github", owner: "me", repo: "shop" },
    ]);
  });
});

describe("reposOfConfig", () => {
  it("reads each repository the remotes name once, and nothing else's url", () => {
    const text = [
      "[core]",
      "\trepositoryformatversion = 0",
      '[remote "origin"]',
      "\turl = git@github.com:acme/shop.git",
      "\tpushurl = https://github.com/acme/shop",
      "\tfetch = +refs/heads/*:refs/remotes/origin/*",
      '[submodule "lib"]',
      "\turl = https://github.com/acme/lib.git",
      '[remote "fork"] URL = "https://github.com/me/shop.git"',
      "[remote.mirror]\r",
      "  url=https://bitbucket.org/acme/shop.git ; kept in step\r",
      '[branch "main"]',
      "\tremote = origin",
    ].join("\n");
    expect(reposOfConfig(text)).toEqual([
      { host: "github", owner: "acme", repo: "shop" },
      { host: "github", owner: "me", repo: "shop" },
      { host: "bitbucket", owner: "acme", repo: "shop" },
    ]);
  });

  it.each(["", "not a config", '[remote "origin"\nurl = git@github.com:acme/shop.git', "\0\0["])(
    "reads no repository from %j",
    (text) => {
      expect(reposOfConfig(text)).toEqual([]);
    },
  );
});
