# Claude fixtures

The synthetic files are so because no Anthropic credentials were available while building the adapter. `anthropic-fetch.ts` replays every file to the SDK as the Messages API streams responses.

| File | Source |
|---|---|
| `small-feature.synthetic.json` | A `count_tokens` answer and one final message per pass for the `small-feature` fixture, shaped like the Messages API's documented response (an empty `thinking` block, as Haiku 5.5 returns by default, then the JSON answer). The answers are the fixture analysis's own intent, and two findings on `receipts.ts`, the first with a guidance mark and the second with a null one. Usage shows a cache write on the first pass and cache reads on the rest. The steps pass's message is the findings pass's with three steps on small-feature in place of its answer. |
| `errors.synthetic.json` | Messages that stop on a refusal, on `max_tokens`, with text that isn't JSON, with JSON outside the schema, and with another pass's answer. Error bodies for 400, 401, 403, 429, 500 and 529 in the API's documented shape. |
| `reading.json` | Recorded with `node evals/claude-live-check.ts --harness --record` on Haiku 5.5 on 2026-11-25: the intent pass's three rounds on `small-feature` with a harness to read, one read, two in parallel, then the answer. The other passes' rounds aren't kept, and message IDs and thinking signatures are replaced. |

## Recording real responses

```bash
node evals/claude-live-check.ts --record
```

It writes `small-feature.json` with the raw response streams (`{ "sse": "…" }` per round of a pass), which `anthropic-fetch.ts` replays byte for byte. Point the import in `claude-analysis-model.test.ts` at it and delete the synthetic file. Responses hold no credentials or personal data; the request bodies aren't kept.

The suggestion call has no file: `claude-suggester.test.ts` answers it with the intent pass's synthetic message, its text replaced by the proposals recorded through Claude Code (below). It was never run on the API.

## Claude Code

`claude-code/` holds the Claude Code transport's `stream-json` output, which `fake-run-claude.ts` replays to the adapter.

| File | Source |
|---|---|
| `intent.jsonl` | Recorded with Claude Code 2.1.303 signed in to a Pro plan, on 2026-11-13: the intent pass on `small-feature`. |
| `findings.synthetic.jsonl` | Synthetic: a pass recorded with `intent.jsonl` with the findings pass's answer in place of its own, until the pass is recorded with `node evals/record-claude-code.ts`. Its first finding carries a guidance mark and its second a null one. |
| `steps.synthetic.jsonl` | Synthetic: `findings.synthetic.jsonl` with three steps on small-feature in place of the findings, until the steps pass is recorded. |
| `suggest.jsonl` | Recorded with Claude Code 2.1.303 signed in to a Pro plan, on 2026-11-17: the suggestion call on `shared/fixtures/suggestion.ts`'s made-up history, on Sonnet 5.5, through `createClaudeCodeSuggester` with a runner that kept its lines. The same fields are kept as for the passes, plus the session's model; thinking blocks are emptied, and the rate limit event keeps only its status and window. |
| `reads.jsonl`, `read-outside.jsonl` | Recorded with Claude Code 2.1.303 on Haiku 5.5 on 2026-11-25: calls with the read tool over three made-up files, one reading them every way and one told to read outside, without the kill. The directory is written as /work, what's above it as /parent and the outside file's as /outside. |
| `not-signed-in.jsonl` | Recorded the same day, with an empty `CLAUDE_CONFIG_DIR`. |
| `errors.synthetic.json` | Synthetic, in the recorded events' shape: the plan's limit reached, overloaded, prompt too long, no connection, a refusal, out of turns, and sessions with a tool, an MCP server or an API key. Claude Code's error codes are the ones its binary names. |

Recorded with `node evals/record-claude-code.ts`, which keeps only the fields the adapter reads, so no paths, account or session IDs.
