// Test support: answers the SDK's requests from fixture messages, streamed as the Messages API
// streams them, and records each request for assertions.

import { ModelPass } from "../../../../domain/review/index.ts";

/** A final message as the API returns it, loosely typed because it comes from a JSON file. */
export interface FixtureMessage {
  readonly content: readonly { readonly type: string; readonly [key: string]: unknown }[];
  readonly stop_reason: string;
  readonly stop_sequence: string | null;
  readonly stop_details: unknown;
  readonly usage: { readonly output_tokens: number; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export interface FixtureHttpError {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

/** A response stream exactly as recorded by the live check. */
export interface RecordedStream {
  readonly sse: string;
}

/**
 * What to answer: a message to stream, a recorded stream, an error response, or a thrown
 * TypeError (no network).
 */
export type FixtureAnswer = FixtureMessage | RecordedStream | FixtureHttpError | "no-network";

export interface RecordedRequest {
  readonly url: string;
  readonly headers: Headers;
  readonly body: {
    readonly messages: readonly {
      readonly role: string;
      readonly content: readonly { readonly type: string; readonly text?: string }[];
      readonly [key: string]: unknown;
    }[];
    readonly [key: string]: unknown;
  };
}

const event = (type: string, data: object): string =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

/** The text in chunks, the way the API streams it. */
const chunks = (text: string): string[] => text.match(/[\s\S]{1,40}/g) ?? [];

/** The event stream that the SDK accumulates back into `message`. */
export const toEventStream = (message: FixtureMessage): string => {
  const { content, stop_reason, stop_sequence, stop_details, usage, ...rest } = message;
  const events = [
    event("message_start", {
      message: {
        ...rest,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        stop_details: null,
        usage: { ...usage, output_tokens: 1, iterations: null },
      },
    }),
  ];
  content.forEach((block, index) => {
    if (block.type === "text") {
      events.push(
        event("content_block_start", { index, content_block: { ...block, text: "" } }),
        ...chunks(String(block.text)).map((text) =>
          event("content_block_delta", { index, delta: { type: "text_delta", text } }),
        ),
      );
    } else if (block.type === "thinking") {
      events.push(
        event("content_block_start", {
          index,
          content_block: { ...block, thinking: "", signature: "" },
        }),
        event("content_block_delta", {
          index,
          delta: { type: "signature_delta", signature: block.signature },
        }),
      );
    } else {
      events.push(event("content_block_start", { index, content_block: block }));
    }
    events.push(event("content_block_stop", { index }));
  });
  events.push(
    event("message_delta", { delta: { stop_reason, stop_sequence, stop_details }, usage }),
    event("message_stop", {}),
  );
  return events.join("");
};

interface TokenCount {
  readonly input_tokens: number;
}

const isHttpError = (answer: FixtureAnswer | TokenCount): answer is FixtureHttpError =>
  typeof answer === "object" && "status" in answer;

const isTokenCount = (answer: FixtureAnswer | TokenCount): answer is TokenCount =>
  typeof answer === "object" && "input_tokens" in answer;

const isRecordedStream = (answer: FixtureAnswer): answer is RecordedStream =>
  typeof answer === "object" && "sse" in answer;

const respond = (answer: FixtureAnswer): Response => {
  if (answer === "no-network") throw new TypeError("fetch failed");
  if (isRecordedStream(answer)) {
    return new Response(answer.sse, { headers: { "content-type": "text/event-stream" } });
  }
  if (isHttpError(answer)) {
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { ...answer.headers },
    });
  }
  return new Response(toEventStream(answer), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
};

/** The pass a request is for, from the instruction that ends it ("Task: risk."). */
export const passOf = (request: RecordedRequest): ModelPass | null => {
  const text = request.body.messages.at(-1)?.content.at(-1)?.text ?? "";
  const pass = ModelPass.safeParse(/^Task: (\w+)\.$/m.exec(text)?.[1]);
  return pass.success ? pass.data : null;
};

/**
 * A fetch for the SDK client. Messages requests are answered per pass, token counting from
 * `countTokens`. Anything else fails the test.
 */
export const createAnthropicFetch = (answers: {
  readonly passes?: Partial<Readonly<Record<ModelPass, FixtureAnswer>>>;
  readonly countTokens?: FixtureAnswer | TokenCount;
}) => {
  const requests: RecordedRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const recorded: RecordedRequest = {
      url: request.url,
      headers: request.headers,
      body: JSON.parse(await request.text()),
    };
    requests.push(recorded);
    const { pathname } = new URL(request.url);

    if (pathname === "/v1/messages/count_tokens") {
      const answer = answers.countTokens;
      if (answer === undefined) throw new Error("No count_tokens answer in the fixture");
      return isTokenCount(answer) ? Response.json(answer) : respond(answer);
    }
    if (pathname === "/v1/messages") {
      const pass = passOf(recorded);
      const answer = pass === null ? undefined : answers.passes?.[pass];
      if (answer === undefined) throw new Error(`No answer in the fixture for pass ${pass}`);
      return respond(answer);
    }
    throw new Error(`Unexpected request to ${request.url}`);
  };
  return { fetch, requests };
};
