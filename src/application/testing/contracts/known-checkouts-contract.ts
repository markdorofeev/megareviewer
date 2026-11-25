import { beforeEach, describe, expect, it } from "vitest";
import type { RepoRef } from "../../../domain/review/index.ts";
import type { KnownCheckouts } from "../../ports/index.ts";
import { FixedClock } from "../fixed-clock.ts";

const repo: RepoRef = { host: "github", owner: "acme", repo: "shop" };
const other: RepoRef = { host: "bitbucket", owner: "acme", repo: "shop" };

export const describeKnownCheckoutsContract = (
  name: string,
  setup: (clock: FixedClock) => KnownCheckouts,
): void => {
  describe(`KnownCheckouts contract: ${name}`, () => {
    let clock: FixedClock;
    let known: KnownCheckouts;
    beforeEach(() => {
      clock = new FixedClock("2026-11-25T10:00:00.000Z");
      known = setup(clock);
    });

    const remember = async (of: RepoRef, dir: string) => {
      await known.rememberFolder(of, dir);
      clock.advance(1000);
    };

    it("knows no folder before one is read", async () => {
      expect(await known.foldersRead(repo)).toEqual([]);
      expect(await known.knownCheckouts()).toEqual([]);
    });

    it("gives a repository's folders, the most recently read first", async () => {
      await remember(repo, "/src/a");
      await remember(repo, "/src/b");
      expect(await known.foldersRead(repo)).toEqual(["/src/b", "/src/a"]);
      await remember(repo, "/src/a");
      expect(await known.foldersRead(repo)).toEqual(["/src/a", "/src/b"]);
    });

    it("keeps repositories apart, by host, owner and name", async () => {
      await remember(repo, "/src/shop");
      for (const not of [other, { ...repo, owner: "lee" }, { ...repo, repo: "shops" }]) {
        expect(await known.foldersRead(not)).toEqual([]);
      }
    });

    it("forgets one folder of one repository", async () => {
      await remember(repo, "/src/a");
      await remember(repo, "/src/b");
      await remember(other, "/src/a");
      await known.forgetFolder(repo, "/src/a");
      await known.forgetFolder(repo, "/src/never-read");
      expect(await known.foldersRead(repo)).toEqual(["/src/b"]);
      expect(await known.foldersRead(other)).toEqual(["/src/a"]);
    });

    it("lists every folder with when it was last read", async () => {
      await remember(repo, "/src/a");
      await remember(other, "/src/b");
      await remember(repo, "/src/a");
      expect(await known.knownCheckouts()).toEqual([
        { repo, dir: "/src/a", lastReadAt: "2026-11-25T10:00:02.000Z" },
        { repo: other, dir: "/src/b", lastReadAt: "2026-11-25T10:00:01.000Z" },
      ]);
    });
  });
};
