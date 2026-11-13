import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type APIRequestContext, test as base, expect } from "@playwright/test";
import { z } from "zod";
import { TOKEN_HEADER } from "../contracts/index.ts";

export const TOKEN = "e2e-token";

const root = fileURLToPath(new URL("..", import.meta.url));

export interface FakeServer {
  /** http://127.0.0.1:<port> */
  readonly url: string;
  /** Sends the session token, for the API and the fake host's /__fake/ control routes. */
  readonly request: APIRequestContext;
}

/**
 * Starts the server's fake mode on a free port, serving the built UI, with the model or without,
 * playing a scenario of Claude's run when one is named.
 */
const start = async (
  ai: boolean,
  scenario: string | null,
): Promise<{ child: ChildProcess; url: string }> => {
  if (!existsSync(`${root}/dist/web/index.html`)) {
    throw new Error("No built UI in dist/web. Run `pnpm build` first.");
  }
  const child = spawn(
    process.execPath,
    [
      "src/cli/dev/fake-main.ts",
      "--port",
      "0",
      "--token",
      TOKEN,
      "--static",
      "dist/web",
      ...(ai ? [] : ["--no-ai"]),
      ...(scenario === null ? [] : ["--scenario", scenario]),
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Fake mode didn't start:\n${output}`)), 30_000);
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /Open (http:\/\/127\.0\.0\.1:\d+)\//.exec(output);
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.on("exit", (code) => reject(new Error(`Fake mode exited with ${code}:\n${output}`)));
  });
  return { child, url };
};

export const test = base.extend<{ ai: boolean; scenario: string | null; server: FakeServer }>({
  /** Whether Request AI review can run; `test.use({ ai: false })` serves it as unavailable. */
  ai: [true, { option: true }],
  /** The scenario Claude's run plays, as `--scenario` names it; `test.use({ scenario: "many" })`. */
  scenario: [null, { option: true }],
  server: async ({ playwright, ai, scenario }, use) => {
    const { child, url } = await start(ai, scenario);
    const request = await playwright.request.newContext({
      baseURL: url,
      extraHTTPHeaders: { [TOKEN_HEADER]: TOKEN },
    });
    await use({ url, request });
    await request.dispose();
    child.kill();
  },
  baseURL: async ({ server }, use) => use(server.url),
});

export { expect };

export const PR = {
  smallFeature: "https://github.com/acme/shop/pull/101",
  refactorMove: "https://github.com/acme/shop/pull/102",
  /** small-feature again; Claude's first run on it fails at the intent stage. */
  intentFailsOnce: "https://github.com/acme/shop/pull/104",
} as const;

/** What the fake hosts received, as GET /__fake/publications reports it. */
const PublishAttempts = z.object({
  attempts: z.array(
    z.object({
      publication: z.object({
        verdict: z.string(),
        summary: z.string(),
        comments: z.array(z.object({ key: z.string(), body: z.string() })),
      }),
      postedKeys: z.array(z.string()),
      outcome: z.enum(["published", "failed"]),
    }),
  ),
});
export type PublishAttempt = z.infer<typeof PublishAttempts>["attempts"][number];

export const publishAttempts = async (server: FakeServer): Promise<PublishAttempt[]> => {
  const response = await server.request.get("/__fake/publications");
  expect(response.ok()).toBe(true);
  return PublishAttempts.parse(await response.json()).attempts;
};
