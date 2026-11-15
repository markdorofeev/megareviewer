import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIN_NODE } from "../src/cli/node-version.ts";

const SCRIPT = join(import.meta.dirname, "..", "install.sh");

// Fakes on the PATH, each recording its arguments instead of reaching the network: node answers
// its version, npm its global prefix, curl copies a local tarball, and gh answers as told.
// gh is always faked, since CI runners have a real one in /usr/bin.
const FAKES = {
  node: `#!/bin/sh
echo "$FAKE_NODE_VERSION"
`,
  npm: `#!/bin/sh
if [ "$1" = prefix ]; then echo "$FAKE_PREFIX"; exit 0; fi
echo "npm $*" >> "$FAKE_LOG"
`,
  curl: `#!/bin/sh
echo "curl $*" >> "$FAKE_LOG"
[ -n "\${FAKE_CURL_FAILS:-}" ] && exit 22
while [ "$1" != -o ]; do shift; done
cp "$FAKE_TARBALL" "$2"
`,
  gh: `#!/bin/sh
if [ "$1" = auth ]; then [ -z "\${FAKE_GH_SIGNED_OUT:-}" ]; exit; fi
echo "gh $*" >> "$FAKE_LOG"
[ -z "\${FAKE_GH_UNVERIFIED:-}" ]
`,
};

let dir: string;
let fakeBin: string;
let log: string;
let home: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "megareviewer-install-"));
  fakeBin = join(dir, "fake-bin");
  log = join(dir, "calls.log");
  home = join(dir, "home");
  mkdirSync(fakeBin);
  for (const [name, body] of Object.entries(FAKES)) {
    writeFileSync(join(fakeBin, name), body);
    chmodSync(join(fakeBin, name), 0o755);
  }
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const install = (
  options: { nodeVersion?: string; prefix?: string; path?: string; withoutNode?: boolean },
  env: Record<string, string> = {},
) => {
  if (options.withoutNode) rmSync(join(fakeBin, "node"));
  const result = spawnSync("/bin/sh", [SCRIPT], {
    encoding: "utf8",
    env: {
      PATH: options.path ?? `${fakeBin}:/usr/bin:/bin`,
      HOME: home,
      FAKE_NODE_VERSION: options.nodeVersion ?? "24.1.0",
      FAKE_PREFIX: options.prefix ?? join(dir, "prefix"),
      FAKE_LOG: log,
      ...env,
    },
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls };
};

const packageTarball = (version: string, files: { cli?: boolean } = {}): string => {
  const source = mkdtempSync(join(dir, "package-"));
  mkdirSync(join(source, "package", "dist"), { recursive: true });
  writeFileSync(
    join(source, "package", "package.json"),
    `{\n  "name": "megareviewer",\n  "version": "${version}",\n  "type": "module"\n}\n`,
  );
  if (files.cli ?? true) {
    writeFileSync(join(source, "package", "dist", "cli.js"), "#!/usr/bin/env node\n");
  }
  const tarball = join(source, "megareviewer.tgz");
  execFileSync("tar", ["-czf", tarball, "-C", source, "package"]);
  return tarball;
};

describe("install.sh", () => {
  it("needs the same Node as the CLI", () => {
    const script = readFileSync(SCRIPT, "utf8");
    expect(script).toContain(`MIN_NODE_MAJOR=${MIN_NODE.major}\n`);
    expect(script).toContain(`MIN_NODE_MINOR=${MIN_NODE.minor}\n`);
  });

  it("refuses a Node older than the CLI runs on", () => {
    const result = install({ nodeVersion: "22.12.0" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("needs Node 22.13 or later, but this is Node 22.12.0");
    expect(result.calls).toEqual([]);
  });

  it("accepts a newer major whose minor is lower", () => {
    mkdirSync(join(dir, "prefix"), { recursive: true });
    expect(install({ nodeVersion: "24.0.0" }).status).toBe(0);
  });

  it("says where to get Node when there's none", () => {
    const result = install({ withoutNode: true, path: fakeBin });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("https://nodejs.org");
  });

  it("refuses a source it doesn't know", () => {
    const result = install({}, { MEGAREVIEWER_SOURCE: "brew" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MEGAREVIEWER_SOURCE is "brew"; it can be npm or github');
  });

  describe("from npm", () => {
    it("installs the latest version into a writable global prefix", () => {
      const prefix = join(dir, "prefix");
      mkdirSync(join(prefix, "lib", "node_modules"), { recursive: true });
      const result = install({ prefix, path: `${fakeBin}:${prefix}/bin:/usr/bin:/bin` });
      expect(result.status).toBe(0);
      expect(result.calls).toEqual(["npm install -g megareviewer@latest"]);
      expect(result.stdout).toContain("Installed. Run `megareviewer doctor`");
    });

    it("installs the version asked for, with or without its v", () => {
      mkdirSync(join(dir, "prefix"), { recursive: true });
      expect(install({}, { MEGAREVIEWER_VERSION: "v0.2.9" }).calls).toEqual([
        "npm install -g megareviewer@0.2.9",
      ]);
    });

    it("installs into ~/.local when the global prefix isn't writable, and says to add it to the PATH", () => {
      const prefix = join(dir, "root-owned");
      mkdirSync(join(prefix, "lib", "node_modules"), { recursive: true });
      chmodSync(join(prefix, "lib", "node_modules"), 0o555);
      const result = install({ prefix });
      chmodSync(join(prefix, "lib", "node_modules"), 0o755);
      const local = join(home, ".local");
      expect(result.status).toBe(0);
      expect(result.calls).toEqual([`npm install -g --prefix ${local} megareviewer@latest`]);
      expect(result.stdout).toContain(`export PATH="${local}/bin:$PATH"`);
    });
  });

  describe("from GitHub", () => {
    const github = (env: Record<string, string> = {}) => ({
      MEGAREVIEWER_SOURCE: "github",
      FAKE_TARBALL: packageTarball("0.2.10"),
      ...env,
    });
    const installed = () => join(home, ".local", "share", "megareviewer");
    const link = () => join(home, ".local", "bin", "megareviewer");

    it("installs the latest release's package, verified, and links the command", () => {
      const result = install({}, github());
      expect(result.status).toBe(0);
      expect(result.calls[0]).toContain(
        "curl -fsSL https://github.com/markdorofeev/megareviewer/releases/latest/download/megareviewer.tgz -o ",
      );
      expect(result.calls[1]).toMatch(
        /^gh attestation verify \S+ --repo markdorofeev\/megareviewer --signer-workflow markdorofeev\/megareviewer\/\.github\/workflows\/release\.yml$/,
      );
      expect(result.stdout).toContain("Verified: built from markdorofeev/megareviewer");
      expect(result.stdout).toContain("Installed megareviewer 0.2.10");
      expect(readlinkSync(link())).toBe(join(installed(), "dist", "cli.js"));
      expect(result.stdout).toContain(`export PATH="${join(home, ".local", "bin")}:$PATH"`);
    });

    it("downloads the version asked for", () => {
      const result = install({}, github({ MEGAREVIEWER_VERSION: "v0.2.10" }));
      expect(result.calls[0]).toContain(
        "https://github.com/markdorofeev/megareviewer/releases/download/v0.2.10/megareviewer.tgz",
      );
    });

    it("needs no npm", () => {
      rmSync(join(fakeBin, "npm"));
      expect(install({}, github()).status).toBe(0);
    });

    it("replaces the version installed before", () => {
      install({}, github());
      const result = install({}, github({ FAKE_TARBALL: packageTarball("0.2.11") }));
      expect(result.stdout).toContain("Installed megareviewer 0.2.11");
      expect(readFileSync(join(installed(), "package.json"), "utf8")).toContain('"0.2.11"');
    });

    it("installs without verifying when gh isn't signed in, and says so", () => {
      const result = install({}, github({ FAKE_GH_SIGNED_OUT: "1" }));
      expect(result.status).toBe(0);
      expect(result.calls.some((call) => call.startsWith("gh attestation"))).toBe(false);
      expect(result.stdout).toContain("Not verified");
    });

    it("installs nothing when the download isn't attested", () => {
      install({}, github());
      const result = install(
        {},
        github({ FAKE_GH_UNVERIFIED: "1", FAKE_TARBALL: packageTarball("0.2.11") }),
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("isn't attested");
      expect(readFileSync(join(installed(), "package.json"), "utf8")).toContain('"0.2.10"');
    });

    it("keeps what's installed when the download fails", () => {
      install({}, github());
      const result = install({}, github({ FAKE_CURL_FAILS: "1" }));
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Couldn't download");
      expect(existsSync(join(installed(), "dist", "cli.js"))).toBe(true);
    });

    it("refuses a download that isn't a megareviewer package", () => {
      const result = install(
        {},
        github({ FAKE_TARBALL: packageTarball("0.2.10", { cli: false }) }),
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("isn't a megareviewer package");
      expect(existsSync(link())).toBe(false);
    });

    it("leaves no download behind", () => {
      install({}, github());
      install({}, github({ FAKE_CURL_FAILS: "1" }));
      const share = join(home, ".local", "share");
      expect(readdirSync(share)).toEqual(["megareviewer"]);
    });
  });
});
