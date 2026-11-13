import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=eval", "-c", "user.email=eval@example.com", ...args], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });

const writeFiles = (root: string, files: Readonly<Record<string, string>>) => {
  for (const entry of readdirSync(root)) {
    if (entry !== ".git") rmSync(join(root, entry), { recursive: true });
  }
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
};

export const gitDiff = (
  baseFiles: Readonly<Record<string, string>>,
  headFiles: Readonly<Record<string, string>>,
): string => {
  const root = mkdtempSync(join(tmpdir(), "megareviewer-eval-"));
  try {
    git(root, "init", "--quiet");
    writeFiles(root, baseFiles);
    git(root, "add", "--all");
    git(root, "commit", "--quiet", "--allow-empty", "--message", "base");
    writeFiles(root, headFiles);
    git(root, "add", "--all");
    git(root, "commit", "--quiet", "--message", "head");
    return git(root, "-c", "core.abbrev=7", "diff", "--no-color", "--no-ext-diff", "-M", "HEAD~1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
