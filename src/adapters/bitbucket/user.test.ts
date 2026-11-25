import { describe, expect, it } from "vitest";
import {
  createFixtureFetch,
  type RecordedExchange,
  RecordingLogger,
} from "../../application/testing/index.ts";
import type { RepoRef } from "../../domain/review/index.ts";
import { createBitbucketClient } from "./client.ts";
import { createUserLookup, permissionsUrl, USER_URL } from "./user.ts";

const LEE = { uuid: "{lee}", display_name: "Lee Park" };
const found = { ok: true, value: { id: "{lee}", name: "Lee Park" } };
const repo: RepoRef = { host: "bitbucket", owner: "globex", repo: "shop" };

const answer = (url: string, status: number, body: unknown): RecordedExchange => ({
  request: { method: "GET", url },
  response: { status, headers: { "content-type": "application/json" }, body },
});
const names = (workspace: string) =>
  answer(permissionsUrl(workspace), 200, { values: [{ user: LEE }] });
const refuses = (workspace: string) =>
  answer(permissionsUrl(workspace), 403, {
    type: "error",
    error: { message: "You do not have access to view this workspace." },
  });
const userNamed = answer(USER_URL, 200, LEE);
const userRefused = answer(USER_URL, 403, {
  type: "error",
  error: {
    message: "Your credentials lack one or more required privilege scopes.",
    detail: { required: ["read:user:bitbucket"], granted: ["read:repository:bitbucket"] },
  },
});

const lookupWith = (exchanges: readonly RecordedExchange[], workspace: string | null) => {
  const recorded = createFixtureFetch(exchanges);
  const urls: string[] = [];
  const client = createBitbucketClient({
    username: "lee",
    password: "token",
    logger: new RecordingLogger(),
    fetch: async (input, init) => {
      urls.push(new Request(input, init).url);
      return recorded(input, init);
    },
  });
  return { lookup: createUserLookup(client, workspace), urls };
};

describe("createUserLookup", () => {
  it("asks the configured workspace alone, once", async () => {
    const { lookup, urls } = lookupWith([names("acme")], "acme");

    expect(await lookup(repo)).toEqual(found);
    expect(await lookup()).toEqual(found);
    expect(urls).toEqual([permissionsUrl("acme")]);
  });

  it("asks the repository's workspace without a configured one", async () => {
    const { lookup, urls } = lookupWith([names("globex")], null);

    expect(await lookup(repo)).toEqual(found);
    expect(urls).toEqual([permissionsUrl("globex")]);
  });

  it("asks the repository's workspace when the configured one doesn't answer", async () => {
    const { lookup } = lookupWith([refuses("acme"), names("globex")], "acme");

    expect(await lookup(repo)).toEqual(found);
  });

  it("asks a workspace once when it's configured and the repository's", async () => {
    const { lookup, urls } = lookupWith([refuses("globex"), userNamed], "globex");

    expect(await lookup(repo)).toEqual(found);
    expect(urls).toEqual([permissionsUrl("globex"), USER_URL]);
  });

  it.each([
    ["refuses", refuses("acme")],
    ["doesn't exist", answer(permissionsUrl("acme"), 404, { error: { message: "No workspace" } })],
    ["has none of the user's repositories", answer(permissionsUrl("acme"), 200, { values: [] })],
  ])("falls back to GET /user when the workspace %s", async (_, exchange) => {
    const { lookup } = lookupWith([exchange, userNamed], "acme");

    expect(await lookup()).toEqual(found);
  });

  it.each([
    [401, "unauthorized"],
    [429, "rate-limited"],
  ])("fails on a %i without asking further", async (status, kind) => {
    const { lookup, urls } = lookupWith([answer(permissionsUrl("acme"), status, null)], "acme");

    const result = await lookup(repo);

    expect(!result.ok && result.error.kind).toBe(kind);
    expect(urls).toHaveLength(1);
  });

  it("says why no workspace answered, and what to set", async () => {
    const { lookup } = lookupWith(
      [answer(permissionsUrl("acme"), 200, { values: [] }), refuses("globex"), userRefused],
      "acme",
    );

    expect(await lookup(repo)).toEqual({
      ok: false,
      error: {
        kind: "forbidden",
        message:
          "Bitbucket didn't say who you are (acme: no repository you were given access to; globex: Bitbucket refused the request: You do not have access to view this workspace.). Set BITBUCKET_WORKSPACE to a workspace with a repository you were given access to, or give the token read:user:bitbucket.",
        retryAfterSeconds: null,
      },
    });
  });

  it("says what to set when there's no workspace to ask", async () => {
    const { lookup } = lookupWith([userRefused], null);

    const result = await lookup();

    expect(!result.ok && result.error.message).toMatch(
      /^Bitbucket didn't say who you are\. Set BITBUCKET_WORKSPACE/,
    );
  });

  it("asks again after a failure, by another repository", async () => {
    const { lookup } = lookupWith([userRefused, names("globex")], null);

    expect((await lookup()).ok).toBe(false);
    expect(await lookup(repo)).toEqual(found);
  });
});
