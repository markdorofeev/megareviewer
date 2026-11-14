# Codex fixtures

Recorded with Codex CLI 0.162.0 on macOS, signed in with ChatGPT, on 2026-11-14.

| File | How |
|---|---|
| `intent.jsonl` … `tour.jsonl` | `node evals/record-codex.ts`: each pass on small-feature, GPT-6 Luna |
| `not-signed-in.jsonl` | The same script, with an empty `CODEX_HOME` |
| `command.jsonl` | Stage 52's task 1: the shell tool turned back on, the model asked to `curl` a local listener, which the sandbox refused |
| `mcp-call.jsonl` | Task 1: code mode asked to call `list_mcp_resources` and `read_mcp_resource` |
| `agent-tool.jsonl` | Task 1: the model asked to spawn an agent and wait for it |
| `api-key-rejected.jsonl` | Task 1: `CODEX_API_KEY` set to a made-up key, which wins over the ChatGPT sign-in |
| `errors.synthetic.json` | Written by hand: the plan's limit, a prompt too long, a refusal, a file change, a web search, an item type Codex doesn't have yet, a turn with no answer. Their messages are guesses at Codex's; the adapter matches loosely |
