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
