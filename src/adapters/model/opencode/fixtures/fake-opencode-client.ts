import { readFileSync } from "node:fs";
import { z } from "zod";
import { ModelPass } from "../../../../domain/review/index.ts";
import { err, ok } from "../../../../domain/shared/index.ts";
import type { OpencodeClient, OpencodeHttpError } from "../opencode-client.ts";

export type RecordedSession =
  | ModelPass
  | "provider-error"
  | "unreachable"
  | "reads-answer"
  | "reads-grep"
  | "reads-nested"
  | "reads-range"
  | "reads-refused";
export type RecordedList = "models" | "providers" | "default-model";

/** The steps pass's session is synthetic, in the recorded sessions' shape, until it's recorded. */
export const recorded = (name: RecordedSession | RecordedList): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`./${name === "steps" ? "steps.synthetic" : name}.json`, import.meta.url),
      "utf8",
    ),
  );

export interface FakeCall {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly query?: string;
}

/** What a pass's session holds once idle, or a request that fails. */
type Answer = unknown | { readonly fail: OpencodeHttpError };

/** Where a session that read files ran, in place of what its recording names. */
export const HARNESS_DIR = "/tmp/megareviewer-harness-fixture";

/** A recorded session that read, as if in `directory`. */
export const recordedReads = (
  name: Extract<RecordedSession, `reads-${string}`>,
  directory: string = HARNESS_DIR,
): unknown =>
  JSON.parse(
    JSON.stringify(recorded(name))
      .replaceAll("$DIR", directory)
      .replaceAll("$OUTSIDENAME", "outside")
      .replaceAll("$OUTSIDE", "/tmp/outside"),
  );

const Session = z.object({ data: z.array(z.record(z.string(), z.unknown())) }).loose();

const PASS = /^Task: (intent|findings|risk|decisions|steps)\./m;

const isFailure = (answer: unknown): answer is { readonly fail: OpencodeHttpError } =>
  typeof answer === "object" && answer !== null && "fail" in answer;

/**
 * Answers a pass's session with the messages `answer` gives for it, read from the prompt's task,
 * and the lists with the recorded ones. Every request is kept.
 */
export const createFakeOpencodeClient = (
  answer: (pass: ModelPass | null) => Answer = (pass) => recorded(pass ?? "intent"),
  options: {
    /** A session's loop, until it ends; over at once by default. */
    readonly wait?: (id: string) => Promise<void>;
  } = {},
) => {
  const calls: FakeCall[] = [];
  const prompts = new Map<string, ModelPass | null>();
  let sessions = 0;
  const client: OpencodeClient = {
    async request(method, url, request = {}) {
      const [path = "", query = ""] = url.split("?");
      calls.push({ method, path, body: request.body, ...(query === "" ? {} : { query }) });
      if (path === "/api/model") return ok(recorded("models"));
      if (path === "/api/provider") return ok(recorded("providers"));
      if (path === "/api/model/default") return ok(recorded("default-model"));
      if (method === "POST" && path === "/api/session") {
        sessions += 1;
        return ok({ data: { id: `ses_fake${sessions}` } });
      }
      const id = /ses_\w+/.exec(path)?.[0] ?? "";
      if (path.endsWith("/prompt")) {
        const { body } = request;
        const text =
          typeof body === "object" &&
          body !== null &&
          "text" in body &&
          typeof body.text === "string"
            ? body.text
            : "";
        const pass = ModelPass.safeParse(PASS.exec(text)?.[1]);
        prompts.set(id, pass.success ? pass.data : null);
      }
      if (path.endsWith("/message")) {
        // opencode gives a cursor past the last message too, where there are none.
        if (query.includes("cursor=")) return ok({ data: [], cursor: {} });
        const answered = answer(prompts.get(id) ?? null);
        return isFailure(answered) ? err(answered.fail) : ok(answered);
      }
      if (path.endsWith("/wait")) {
        const answered = answer(prompts.get(id) ?? null);
        if (isFailure(answered) && answered.fail.kind === "timeout") return err(answered.fail);
        await options.wait?.(id);
      }
      return ok(null);
    },
  };
  return { client, calls };
};

/** A recorded session whose answer is replaced: a tool call, another text, a second step. */
export const sessionWith = (
  name: RecordedSession,
  change: (messages: Record<string, unknown>[]) => Record<string, unknown>[],
): unknown => {
  const session = Session.parse(recorded(name));
  return { ...session, data: change(session.data) };
};
