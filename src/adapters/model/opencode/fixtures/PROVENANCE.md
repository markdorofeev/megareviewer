# opencode fixtures

Recorded with opencode 2.3.0 on macOS, its Anthropic provider from `ANTHROPIC_API_KEY`, on 2026-11-14. Messages are a session's `GET /api/session/:id/message` once idle, without `native`, the provider's opaque signatures.

| File | How |
|---|---|
| `models.json`, `providers.json`, `default-model.json` | `node evals/record-opencode.ts`: the server's lists, with free models off |
| `intent.json` … `decisions.json` | The same script: each pass on small-feature, Claude Haiku 5.5, findings sent the fixture analysis's intent |
| `provider-error.json` | Stage 53's spike: an agent with `steps: 1`, whose last step's assistant prefill Haiku 5.5 refused with a 400 |
| `unreachable.json` | The spike: the Anthropic provider's base URL on a local proxy that couldn't forward |

Tool calls, shells, skills, second steps and the providers' other errors are written into these in the tests, so they're synthetic; the model never called its one tool in the spike.
