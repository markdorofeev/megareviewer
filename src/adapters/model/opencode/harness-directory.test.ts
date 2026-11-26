import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { InputHarness } from "../../../application/ports/index.ts";
import { createHarnessDirectories } from "./harness-directory.ts";

const harnessOf = (files: Readonly<Record<string, string>>): InputHarness => ({
  files: [],
  contents: new Map(Object.entries(files)),
});

const gone = (path: string) =>
  stat(path).then(
    () => false,
    () => true,
  );

describe("createHarnessDirectories", () => {
  const harness = harnessOf({ "harness/CLAUDE.md": "# Rules", "harness/docs/a.md": "a" });

  it("writes the files for a pass, and removes them after it, a failed one too", async () => {
    const directories = createHarnessDirectories();
    const seen: string[] = [];
    const answer = await directories.use(harness, async (dir) => {
      seen.push(dir);
      expect(await readFile(join(dir, "harness/docs/a.md"), "utf8")).toBe("a");
      expect((await readdir(dir)).sort()).toEqual(["harness"]);
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
      expect((await stat(join(dir, "harness/CLAUDE.md"))).mode & 0o777).toBe(0o600);
      return 7;
    });
    expect(answer).toBe(7);
    expect(await gone(seen[0] ?? "")).toBe(true);

    await expect(
      directories.use(harness, async (dir) => {
        seen.push(dir);
        throw new Error("the pass failed");
      }),
    ).rejects.toThrow("the pass failed");
    expect(seen[1]).toBe(seen[0]);
    expect(await gone(seen[0] ?? "")).toBe(true);
  });

  it("gives a run's passes one directory, at once and one after another, and another run its own", async () => {
    const directories = createHarnessDirectories();
    const pass = (of: InputHarness) =>
      directories.use(of, async (dir) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(await gone(dir)).toBe(false);
        return dir;
      });
    const intent = await pass(harness);
    const others = await Promise.all([pass(harness), pass(harness), pass(harness)]);
    expect(others).toEqual([intent, intent, intent]);
    expect(await pass(harnessOf({ "harness/CLAUDE.md": "# Rules" }))).not.toBe(intent);
    expect(await gone(intent)).toBe(true);
  });

  it("refuses a path outside the directory, and two paths that are one, leaving nothing", async () => {
    const directories = createHarnessDirectories();
    const never = async () => {
      throw new Error("ran");
    };
    await expect(directories.use(harnessOf({ "../out.md": "x" }), never)).rejects.toThrow(
      "../out.md isn't in the directory",
    );
    await expect(directories.use(harnessOf({ "a.md": "x", "./a.md": "y" }), never)).rejects.toThrow(
      "EEXIST",
    );
  });

  it("leaves alone what something else made at its path", async () => {
    const directories = createHarnessDirectories();
    const dir = await directories.use(harness, async (path) => path);
    await mkdir(dir);
    try {
      await expect(directories.use(harness, async () => "ran")).rejects.toThrow("EEXIST");
      expect(await gone(dir)).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
