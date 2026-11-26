import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CHECKOUT_CONTRACT_FILES,
  describeLocalCheckoutContract,
  describeRepositoryCopiesContract,
  FixedClock,
  RecordingLogger,
} from "../../application/testing/index.ts";
import type { RepoRef } from "../../domain/review/index.ts";
import { isNewEnough } from "./git-version.ts";
import { downloadEnv, type RemoteFor, remotesFor } from "./remote.ts";
import { createRepositoryCopies, type GitRepositoryCopies } from "./repository-copies.ts";
import { type DownloadCall, type RunDownload, runDownload } from "./run-download.ts";
import type { GitOutput } from "./run-git.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const folder = (prefix: string): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
};

const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  }).trim();

const commit = (dir: string, files: Readonly<Record<string, string>>): string => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "files");
  return git(dir, "rev-parse", "HEAD");
};

/** A bare repository that serves any commit by its SHA, as the hosts do, and its two commits. */
const host = (files: Readonly<Record<string, string>> = { "a.ts": "export const a = 1;\n" }) => {
  const work = folder("megareviewer-work-");
  git(work, "init", "-q", "-b", "main");
  const many = Object.fromEntries(
    Array.from({ length: 40 }, (_, at) => [`lib/f${at}.ts`, `export const f${at} = ${at};\n`]),
  );
  const sha = commit(work, files);
  const second = commit(work, many);
  const later = commit(work, { "b.ts": "export const b = 2;\n" });
  const bare = folder("megareviewer-remote-");
  git(bare, "init", "-q", "--bare");
  git(bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  git(work, "push", "-q", bare, "main");
  return { url: `file://${bare}`, sha, second, later };
};

let sharedHost: ReturnType<typeof host> | null = null;
/** One for every test that only downloads from it. */
const shared = () => {
  sharedHost ??= host();
  return sharedHost;
};

const repo: RepoRef = { host: "github", owner: "acme", repo: "shop" };
const other: RepoRef = { host: "bitbucket", owner: "acme", repo: "shop" };
const user = { name: "x-access-token", password: "ghp_secret-token" };

const setup = (
  remoteFor: RemoteFor,
  options: {
    readonly run?: RunDownload;
    readonly on?: boolean;
    readonly folder?: string;
    readonly protocol?: string;
  } = {},
) => {
  const clock = new FixedClock("2026-11-25T10:00:00.000Z");
  const logger = new RecordingLogger();
  const stop = new AbortController();
  const dir = options.folder ?? folder("megareviewer-copies-");
  const copies: GitRepositoryCopies = createRepositoryCopies({
    folder: dir,
    on: options.on ?? true,
    remoteFor,
    clock,
    logger,
    signal: stop.signal,
    protocol: options.protocol ?? "file",
    ...(options.run === undefined ? {} : { run: options.run }),
  });
  return { copies, clock, logger, stop, dir };
};

/** The real runner, recording its calls. */
const recording = (calls: DownloadCall[], run: RunDownload = runDownload): RunDownload => {
  return (call) => {
    calls.push(call);
    return run(call);
  };
};

const fetches = (calls: readonly DownloadCall[]) =>
  calls.filter(({ args }) => args.includes("fetch"));

const output = (code: number | null, stderr = "", stdout = ""): GitOutput => ({
  code,
  stdout: Buffer.from(stdout),
  stderr,
});

/** git as far as a fetch, which answers what it's given. */
const fetching =
  (fetch: (call: DownloadCall) => GitOutput | Promise<GitOutput>): RunDownload =>
  (call) =>
    call.args.includes("fetch") ? Promise.resolve(fetch(call)) : runDownload(call);

describeRepositoryCopiesContract("git", async () => {
  const { url, sha, later } = shared();
  const { copies, clock } = setup(() => ({ url, user }));
  const { copies: off } = setup(() => ({ url, user }), { on: false });
  return { copies, off, clock, repo, other, sha, later, path: "a.ts" };
});

describeLocalCheckoutContract("a downloaded commit", async () => {
  const { url, sha } = host(CHECKOUT_CONTRACT_FILES);
  const { copies } = setup(() => ({ url, user }));
  const copy = await copies.download(repo, sha);
  if (!copy.ok) throw new Error(copy.error.message);
  return { checkout: copy.value.checkout, sha };
});

describe("a download", () => {
  it("keeps a ref for each commit, in a bare copy named after the repository", async () => {
    const { url, sha, later } = shared();
    const { copies, dir } = setup(() => ({ url, user }));
    await copies.download({ ...repo, owner: "Acme", repo: "Shop" }, sha);
    await copies.download(repo, later);
    const copy = join(dir, "github", "acme", "shop.git");
    expect(git(copy, "for-each-ref", "--format=%(refname)").split("\n").sort()).toEqual(
      [`refs/megareviewer/${sha}`, `refs/megareviewer/${later}`].sort(),
    );
    expect(git(copy, "rev-parse", "--is-bare-repository")).toBe("true");
    // Only the commits asked for, without their history.
    expect(git(copy, "rev-list", "--all").split("\n").sort()).toEqual([sha, later].sort());
    expect(existsSync(join(copy, "hooks"))).toBe(false);
  });

  it("transfers only what the copy doesn't have", async () => {
    const { url, second, later } = shared();
    const { copies, dir } = setup(() => ({ url, user }));
    const copy = join(dir, "github", "acme", "shop.git");
    const objects = () =>
      readdirSync(join(copy, "objects"), { recursive: true, withFileTypes: true }).filter(
        (entry) => entry.isFile() && /^[0-9a-f]{38}$/.test(entry.name),
      ).length;
    await copies.download(repo, second);
    const first = objects();
    await copies.download(repo, later);
    // The commit, its root tree and one file, where the first had 40 files more.
    expect(first).toBeGreaterThan(40);
    expect(objects() - first).toBe(3);
  });

  it("downloads a commit once for requests made together, and one commit after another", async () => {
    const { url, sha, later } = shared();
    const calls: DownloadCall[] = [];
    let going = 0;
    let most = 0;
    const run = recording(calls, async (call) => {
      going += 1;
      most = Math.max(most, going);
      const result = await runDownload(call);
      going -= 1;
      return result;
    });
    const { copies } = setup(() => ({ url, user }), { run });
    await Promise.all([
      copies.download(repo, sha),
      copies.download(repo, sha),
      copies.download(repo, later),
    ]);
    expect(fetches(calls)).toHaveLength(2);
    expect(most).toBe(1);
    await copies.download(repo, sha);
    expect(fetches(calls)).toHaveLength(2);
  });

  it("reads a copy without downloading, and while it's off", async () => {
    const { url, sha } = shared();
    const { copies, dir } = setup(() => ({ url, user }));
    await copies.download(repo, sha);
    const calls: DownloadCall[] = [];
    const { copies: off } = setup(() => ({ url, user }), {
      folder: dir,
      on: false,
      run: recording(calls),
    });
    expect(await (await off.find(repo, sha))?.checkout.hasCommit(sha)).toBe(true);
    expect(calls).toEqual([]);
  });

  it("isn't stopped from reading its copy by the reviewer's git config", async () => {
    const { url, sha } = shared();
    const { copies } = setup(() => ({ url, user }));
    await copies.download(repo, sha);
    const config = join(folder("megareviewer-config-"), "gitconfig");
    writeFileSync(config, "[safe]\n\tbareRepository = explicit\n");
    const before = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = config;
    try {
      const copy = await copies.find(repo, sha);
      expect(await copy?.checkout.filesMentioning(sha, ["export"])).toEqual({
        ok: true,
        value: ["a.ts"],
      });
    } finally {
      if (before === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = before;
    }
  });

  it("packs its downloads together once there are more than a few, keeping every commit", async () => {
    const work = folder("megareviewer-work-");
    git(work, "init", "-q", "-b", "main");
    git(work, "config", "uploadpack.allowAnySHA1InWant", "true");
    const shas = Array.from({ length: 7 }, (_, at) => commit(work, { "a.ts": `${at}\n` }));
    const calls: DownloadCall[] = [];
    // Packs even the few objects of this repository, as a real one's downloads are.
    const run = recording(calls, (call) =>
      runDownload(
        call.args.includes("fetch")
          ? { ...call, args: ["-c", "fetch.unpackLimit=1", ...call.args] }
          : call,
      ),
    );
    const { copies, dir } = setup(() => ({ url: `file://${work}`, user }), { run });
    for (const sha of shas) await copies.download(repo, sha);
    await copies.settled();
    expect(calls.filter(({ args }) => args.includes("gc"))).toHaveLength(1);
    const packs = readdirSync(join(dir, "github", "acme", "shop.git", "objects", "pack"));
    expect(packs.filter((name) => name.endsWith(".pack")).length).toBeLessThan(shas.length);
    for (const sha of shas) expect(await copies.find(repo, sha)).not.toBeNull();
  });

  it("says when the remote doesn't have the repository, and leaves no copy", async () => {
    const { copies, dir } = setup(() => ({ url: `file://${tmpdir()}/megareviewer-none`, user }));
    const result = await copies.download(repo, "a".repeat(40));
    expect(!result.ok && result.error.kind).toBe("failed");
    expect(existsSync(join(dir, "github", "acme", "shop.git"))).toBe(false);
  });

  it.each([
    ["..", "shop"],
    ["acme", "."],
    ["acme", "a/b"],
    ["acme", "a b"],
  ])("puts no name a host wouldn't have in a path: %s/%s", async (owner, name) => {
    const calls: DownloadCall[] = [];
    const { copies } = setup(() => ({ url: "file:///nowhere", user }), { run: recording(calls) });
    const odd = { host: "github" as const, owner, repo: name };
    const result = await copies.download(odd, "a".repeat(40));
    expect(!result.ok && result.error.kind).toBe("failed");
    expect(await copies.find(odd, "a".repeat(40))).toBeNull();
    expect(calls).toEqual([]);
  });

  it("asks for nothing but a whole SHA", async () => {
    const calls: DownloadCall[] = [];
    const { copies } = setup(() => ({ url: "file:///nowhere", user }), { run: recording(calls) });
    for (const sha of ["--upload-pack=touch", "main", "abc1234"]) {
      expect((await copies.download(repo, sha)).ok).toBe(false);
      expect(await copies.find(repo, sha)).toBeNull();
    }
    expect(calls).toEqual([]);
  });

  it("says when there's no git, or one too old", async () => {
    const missing = setup(() => ({ url: "file:///nowhere", user }), {
      run: async () => output(null, "git couldn't be started"),
    });
    expect(await missing.copies.download(repo, "a".repeat(40))).toMatchObject({
      error: { kind: "no-git", message: expect.stringContaining("isn't installed") },
    });
    const old = setup(() => ({ url: "file:///nowhere", user }), {
      run: async () => output(0, "", "git version 2.25.1\n"),
    });
    expect(await old.copies.download(repo, "a".repeat(40))).toMatchObject({
      error: {
        kind: "no-git",
        message: "git 2.25.1 is too old to download with. Install 2.32 or newer.",
      },
    });
  });

  it("says when the host has no credentials", async () => {
    const { copies } = setup(() => null);
    expect(await copies.download(other, "a".repeat(40))).toMatchObject({
      error: { kind: "no-credentials", message: "megareviewer has no Bitbucket credentials." },
    });
  });

  // git's and the hosts' own words, as they answered on 2026-11-25.
  it.each([
    [
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      "refused",
      "GitHub didn't let megareviewer download acme/shop. Check that the GitHub token can read this repository's contents.",
    ],
    [
      "remote: Repository not found.\nfatal: repository 'https://github.com/acme/shop.git/' not found",
      "refused",
      "GitHub didn't let megareviewer download acme/shop: Repository not found. Check that the GitHub token can read this repository's contents.",
    ],
    [
      "fatal: unable to access 'https://github.com/acme/shop.git/': The requested URL returned error: 403",
      "refused",
      "GitHub didn't let megareviewer download acme/shop. Check that the GitHub token can read this repository's contents.",
    ],
    [
      "fatal: remote error: upload-pack: not our ref aaaa",
      "missing-commit",
      "GitHub doesn't have commit aaaaaaa of acme/shop any more. Its branch may have been force-pushed or deleted.",
    ],
    [
      "fatal: unable to access 'https://github.com/acme/shop.git/': The requested URL returned error: 301",
      "failed",
      "acme/shop has moved on GitHub. Open the pull request from the repository's new address.",
    ],
    [
      "fatal: unable to access 'https://github.com/acme/shop.git/': Could not resolve host: github.com",
      "failed",
      "git couldn't download acme/shop: unable to access 'https://github.com/acme/shop.git/': Could not resolve host: github.com.",
    ],
  ])("says why: %s", async (stderr, kind, message) => {
    const { copies } = setup(() => ({ url: "file:///nowhere", user }), {
      run: fetching(() => output(128, stderr)),
    });
    expect(await copies.download(repo, "a".repeat(40))).toEqual({
      ok: false,
      error: { kind, message },
    });
  });

  it("says how to get past a lock a killed download left", async () => {
    const { url, sha, later } = shared();
    const { copies, dir } = setup(() => ({ url, user }));
    await copies.download(repo, sha);
    const copy = join(dir, "github", "acme", "shop.git");
    writeFileSync(join(copy, "shallow.lock"), "");
    expect(await copies.download(repo, later)).toEqual({
      ok: false,
      error: {
        kind: "failed",
        message: `Another download into ${copy} is going, or was cut off. If none is, delete that folder.`,
      },
    });
    expect(await copies.find(repo, sha)).not.toBeNull();
  });

  it("never repeats the credentials, should git print them", async () => {
    const basic = Buffer.from(`${user.name}:${user.password}`).toString("base64");
    const { copies, logger } = setup(() => ({ url: "file:///nowhere", user }), {
      run: fetching(() => output(128, `fatal: ${user.password} and ${basic} failed`)),
    });
    const result = await copies.download(repo, "a".repeat(40));
    expect(result).toMatchObject({
      error: { message: "git couldn't download acme/shop: *** and *** failed." },
    });
    expect(JSON.stringify(logger.entries)).not.toContain(user.password);
  });

  it("says when the copy can't be written", async () => {
    const dir = folder("megareviewer-copies-");
    writeFileSync(join(dir, "github"), "a file where the folder goes");
    const { copies } = setup(() => ({ url: "file:///nowhere", user }), { folder: dir });
    expect(await copies.download(repo, "a".repeat(40))).toMatchObject({
      error: { kind: "failed", message: expect.stringContaining("couldn't write its copy") },
    });
  });
});

describe("a download that's cut off", () => {
  /** A fetch that leaves a half-made pack, then waits to be killed. */
  const hanging = (started: () => void) =>
    fetching(
      ({ args, signal }) =>
        new Promise<GitOutput>((resolve) => {
          const dir = (args[0] ?? "").replace("--git-dir=", "");
          mkdirSync(join(dir, "objects", "pack"), { recursive: true });
          writeFileSync(join(dir, "objects", "pack", "tmp_pack_x"), "half");
          signal.addEventListener("abort", () => resolve(output(null)));
          started();
        }),
    );

  it("is stopped with megareviewer, and leaves nothing behind", async () => {
    const { promise: fetchStarted, resolve: started } = Promise.withResolvers<void>();
    const { copies, stop, dir } = setup(() => ({ url: "file:///nowhere", user }), {
      run: hanging(started),
    });
    const download = copies.download(repo, "a".repeat(40));
    await fetchStarted;
    stop.abort();
    expect(await download).toMatchObject({ error: { kind: "stopped" } });
    await copies.settled();
    expect(existsSync(join(dir, "github", "acme", "shop.git"))).toBe(false);
    expect(await copies.find(repo, "a".repeat(40))).toBeNull();
    expect(await copies.download(repo, "b".repeat(40))).toMatchObject({
      error: { kind: "stopped" },
    });
  });

  it("fails after 10 minutes", async () => {
    const { promise: fetchStarted, resolve: started } = Promise.withResolvers<void>();
    const { copies, clock } = setup(() => ({ url: "file:///nowhere", user }), {
      run: hanging(started),
    });
    const download = copies.download(repo, "a".repeat(40));
    await fetchStarted;
    clock.advance(10 * 60 * 1000);
    expect(await download).toMatchObject({
      error: { kind: "timed-out", message: expect.stringContaining("longer than 10 minutes") },
    });
  });

  it("keeps what an earlier download left, without the half-made pack", async () => {
    const { url, sha } = shared();
    const { copies, dir } = setup(() => ({ url, user }));
    await copies.download(repo, sha);
    const { promise: fetchStarted, resolve: started } = Promise.withResolvers<void>();
    const { copies: again, stop } = setup(() => ({ url, user }), {
      folder: dir,
      run: hanging(started),
    });
    const download = again.download(repo, "a".repeat(40));
    await fetchStarted;
    stop.abort();
    await download;
    expect(await again.find(repo, "a".repeat(40))).toBeNull();
    expect(await again.find(repo, sha)).not.toBeNull();
    const pack = join(dir, "github", "acme", "shop.git", "objects", "pack");
    expect(readdirSync(pack)).not.toContain("tmp_pack_x");
  });

  it("isn't read when its objects came without its ref", async () => {
    const { url, sha } = shared();
    const { copies, dir } = setup(() => ({ url, user }));
    await copies.download(repo, sha);
    const copy = join(dir, "github", "acme", "shop.git");
    git(copy, "update-ref", "-d", `refs/megareviewer/${sha}`);
    expect(await copies.find(repo, sha)).toBeNull();
    expect((await copies.download(repo, sha)).ok).toBe(true);
  });

  it("kills the helper git talks to the host through, when the host never answers", async () => {
    const dir = folder("megareviewer-stalled-");
    git(dir, "init", "-q", "--bare");
    const { promise: connected, resolve: connect } = Promise.withResolvers<Socket>();
    const server = createServer((request) => connect(request.socket));
    await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
    const stop = new AbortController();
    try {
      const address = server.address();
      const port = typeof address === "object" ? address?.port : null;
      const running = runDownload({
        args: ["--git-dir", dir, "fetch", "-q", `http://127.0.0.1:${port}/shop.git`],
        env: { PATH: process.env.PATH ?? "", GIT_CONFIG_GLOBAL: devNull, HOME: dir },
        signal: stop.signal,
      });
      const socket = await connected;
      const hungUp = new Promise((closed) => socket.once("close", closed));
      stop.abort();
      expect((await running).code).not.toBe(0);
      await hungUp;
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it("kills the git that's running, and starts none after", async () => {
    const stop = new AbortController();
    const dir = folder("megareviewer-kill-");
    git(dir, "init", "-q", "--bare");
    // An upload-pack waits on its stdin for a client; a wait this one ends at once.
    const running = runDownload({
      args: ["-c", "alias.wait=!sleep 60", "--git-dir", dir, "wait"],
      env: { PATH: process.env.PATH ?? "" },
      signal: stop.signal,
    });
    stop.abort();
    expect((await running).code).not.toBe(0);
    expect(await runDownload({ args: ["--version"], env: {}, signal: stop.signal })).toMatchObject({
      code: null,
    });
  });
});

describe("the lockdown", () => {
  const BASIC = Buffer.from(`x-access-token:${user.password}`).toString("base64");
  const remoteFor = remotesFor({ github: { token: user.password }, bitbucket: null });

  const locked = async () => {
    const calls: DownloadCall[] = [];
    const run = recording(calls, (call) =>
      call.args.includes("fetch") ? Promise.resolve(output(128, "fatal: no")) : runDownload(call),
    );
    const dir = folder("megareviewer-copies-");
    const copy = join(dir, "github", "acme", "shop.git");
    mkdirSync(copy, { recursive: true });
    // An earlier download's, so that a failure keeps the copy to look at.
    writeFileSync(join(copy, "megareviewer-last-read"), "2026-11-25T09:00:00.000Z");
    const { copies } = setup(remoteFor, { run, folder: dir, protocol: "https" });
    await copies.download(repo, "a".repeat(40));
    return { calls, copy };
  };

  it("puts the token in no argument, and in no file of the copy", async () => {
    const { calls, copy } = await locked();
    expect(calls.map(({ args }) => args.find((arg) => /^[a-z]/.test(arg)) ?? args[0])).toEqual([
      "--version",
      "init",
      "fetch",
    ]);
    for (const { args } of calls) {
      expect(args.join(" ")).not.toContain(user.password);
      expect(args.join(" ")).not.toContain(BASIC);
    }
    const files = readdirSync(copy, { recursive: true, encoding: "utf8" })
      .map((name) => join(copy, name))
      .filter((path) => statSync(path).isFile());
    expect(files.some((path) => path.endsWith("config"))).toBe(true);
    for (const path of files) {
      const text = readFileSync(path, "utf8");
      expect(text).not.toContain(user.password);
      expect(text).not.toContain(BASIC);
    }
  });

  it("gives the token to the fetch alone, for the host's own origin", async () => {
    const { calls } = await locked();
    const values = calls.map(({ env }) => Object.values(env).filter((one) => one.includes(BASIC)));
    expect(values).toEqual([[], [], [`Authorization: Basic ${BASIC}`]]);
    const env = calls[2]?.env ?? {};
    const at = Object.entries(env).find(([, value]) => value.includes(BASIC))?.[0];
    expect(env[(at ?? "").replace("VALUE", "KEY")]).toBe("http.https://github.com/.extraHeader");
  });

  it("uses none of the reviewer's environment or config but what git needs to run", () => {
    const env = downloadEnv({
      env: {
        PATH: "/bin",
        HTTPS_PROXY: "http://proxy:3128",
        GITHUB_TOKEN: "ghp_other",
        GIT_DIR: "/elsewhere",
        GIT_SSH_COMMAND: "touch /tmp/x",
        GIT_CONFIG_PARAMETERS: "'core.askPass'='x'",
        SSH_ASKPASS: "/bin/ask",
        XDG_CONFIG_HOME: "/home/lee/.config",
        HOME: "/home/lee",
      },
      home: "/copies",
      remote: { url: "https://github.com/acme/shop.git", user },
      protocol: "https",
    });
    const config = Object.fromEntries(
      Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, at) => [
        env[`GIT_CONFIG_KEY_${at}`],
        env[`GIT_CONFIG_VALUE_${at}`],
      ]),
    );
    expect(config).toMatchObject({
      "protocol.allow": "never",
      "protocol.https.allow": "always",
      "http.followRedirects": "false",
      "credential.helper": "",
      "core.hooksPath": "/dev/null",
    });
    expect(Object.keys(env).filter((name) => !name.startsWith("GIT_CONFIG_"))).toEqual([
      "PATH",
      "HTTPS_PROXY",
      "HOME",
      "LC_ALL",
      "GIT_ALLOW_PROTOCOL",
      "GIT_TERMINAL_PROMPT",
      "GIT_ASKPASS",
    ]);
    expect(env).toMatchObject({
      HOME: "/copies",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_ALLOW_PROTOCOL: "https",
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "",
    });
    expect(env.GIT_CONFIG_PARAMETERS).toBeUndefined();
  });

  it("reaches no remote over another protocol", async () => {
    const { url, sha } = shared();
    const { copies } = setup(() => ({ url, user }), { protocol: "https" });
    expect(await copies.download(repo, sha)).toMatchObject({
      error: { kind: "failed", message: expect.stringContaining("transport 'file' not allowed") },
    });
  });

  it("runs no shell", async () => {
    const dir = folder("megareviewer-shell-");
    const { code } = await runDownload({
      args: ["--version", `; touch ${dir}/made`, `$(touch ${dir}/made)`],
      env: { PATH: process.env.PATH ?? "" },
      signal: new AbortController().signal,
    });
    expect(code).not.toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("says when git can't be started", async () => {
    const result = await runDownload({
      args: ["--version"],
      env: { PATH: folder("megareviewer-empty-") },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ code: null, stderr: "git couldn't be started" });
  });
});

describe("remotesFor", () => {
  it("names each host's repository over HTTPS, without the credentials", () => {
    const remoteFor = remotesFor({
      github: { token: "ghp_x" },
      bitbucket: { username: "lee", password: "app" },
    });
    expect(remoteFor(repo)).toEqual({
      url: "https://github.com/acme/shop.git",
      user: { name: "x-access-token", password: "ghp_x" },
    });
    expect(remoteFor(other)).toEqual({
      url: "https://bitbucket.org/acme/shop.git",
      user: { name: "lee", password: "app" },
    });
  });

  it("signs a Bitbucket API token in by its own name, not by the email the API takes", () => {
    const remoteFor = remotesFor({
      github: null,
      bitbucket: { username: "lee@example.com", password: "ATAT" },
    });
    expect(remoteFor(other)?.user).toEqual({
      name: "x-bitbucket-api-token-auth",
      password: "ATAT",
    });
    expect(remoteFor(repo)).toBeNull();
  });
});

describe("copies on disk", () => {
  it("lists them with their size and when they were read", async () => {
    const { url, sha } = shared();
    const { copies, dir } = setup(() => ({ url, user }));
    expect(await copies.list()).toEqual([]);
    await copies.download(repo, sha);
    mkdirSync(join(dir, "github", "acme", "not-a-copy"));
    expect(await copies.list()).toEqual([
      {
        repo,
        dir: join(dir, "github", "acme", "shop.git"),
        bytes: expect.any(Number),
        lastReadAt: "2026-11-25T10:00:00.000Z",
      },
    ]);
    expect((await copies.list())[0]?.bytes).toBeGreaterThan(100);
  });

  it("forgets one that was never read, and nothing that isn't a copy", async () => {
    const { copies, dir } = setup(() => null);
    mkdirSync(join(dir, "github", "acme", "shop.git"), { recursive: true });
    mkdirSync(join(dir, "github", "acme", "notes"));
    mkdirSync(join(dir, "elsewhere", "acme", "shop.git"), { recursive: true });
    expect(await copies.forget("2026-11-25T10:00:00.000Z")).toBe(1);
    expect(existsSync(join(dir, "github", "acme", "shop.git"))).toBe(false);
    expect(existsSync(join(dir, "github", "acme", "notes"))).toBe(true);
    expect(existsSync(join(dir, "elsewhere", "acme", "shop.git"))).toBe(true);
  });
});

describe("isNewEnough", () => {
  it.each([
    ["2.50.1", true],
    ["2.32", true],
    ["3.0.0", true],
    ["2.31.8", false],
    ["1.99.0", false],
  ])("%s: %s", (version, expected) => {
    expect(isNewEnough(version)).toBe(expected);
  });
});
