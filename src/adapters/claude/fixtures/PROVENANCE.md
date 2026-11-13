# Claude fixtures

Both files are synthetic: no Anthropic credentials were available while building the adapter. `anthropic-fetch.ts` replays them to the SDK as the Messages API streams responses.

| File | Source |
|---|---|
| `small-feature.synthetic.json` | A `count_tokens` answer and one final message per pass for the `small-feature` fixture, shaped like the Messages API's documented response (an empty `thinking` block, as Haiku 5.5 returns by default, then the JSON answer). The answers are the fixture analysis's own intent, risk, decisions and tour. Usage shows a cache write on the first pass and cache reads on the rest. |
| `errors.synthetic.json` | Messages that stop on a refusal, on `max_tokens`, with text that isn't JSON, with JSON outside the schema, and with another pass's answer. Error bodies for 400, 401, 403, 429, 500 and 529 in the API's documented shape. |

## Recording real responses

```bash
node evals/claude-live-check.ts --record
```

It writes `small-feature.json` with the raw response streams (`{ "sse": "…" }` per pass), which `anthropic-fetch.ts` replays byte for byte. Point the import in `claude-analysis-model.test.ts` at it and delete the synthetic file. Responses hold no credentials or personal data; the request bodies aren't kept.

## Claude Code

`claude-code/` holds the Claude Code transport's `stream-json` output, which `fake-run-claude.ts` replays to the adapter.

| File | Source |
|---|---|
| `intent.jsonl`, `risk.jsonl`, `decisions.jsonl`, `tour.jsonl` | Recorded with Claude Code 2.1.303 signed in to a Pro plan, on 2026-11-13: the four passes of the AnalysisModel contract on `small-feature`, as the suite sends them. |
| `not-signed-in.jsonl` | Recorded the same day, with an empty `CLAUDE_CONFIG_DIR`. |
| `errors.synthetic.json` | Synthetic, in the recorded events' shape: the plan's limit reached, overloaded, prompt too long, no connection, a refusal, out of turns, and sessions with a tool, an MCP server or an API key. Claude Code's error codes are the ones its binary names. |

Recorded with `node evals/record-claude-code.ts`, which keeps only the fields the adapter reads, so no paths, account or session IDs.
