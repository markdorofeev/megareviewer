# Stage 69: A read tool in every pass, through Claude Code

**Status:** Not started
**Depends on:** 67
**Owns:** the read tool's contract in `src/application/ports/analysis-model.ts`, `src/application/use-cases/model-input.ts` and `model-passes.ts`; `ModelCall.reads` and the guideline fields of `Guidance`; the harness index in `src/adapters/model/shared/render-input.ts`; a pass's directory in `src/adapters/model/shared/run-command.ts`; the Claude Code transport in `src/adapters/model/claude/`; reads in `web/src/pages/review/ModelCalls.tsx` and the usage line; `evals/spikes/harness-read-tool/`; the read tool's text in DESIGN.md, ARCHITECTURE.md and ENGINEERING.md

## Read first

- [The slice in the plan README](README.md#eighteenth-slice-the-repositorys-harness): no MCP, no tool on Codex, and the room left for a checkout.
- The spike's results, `evals/spikes/harness-read-tool/RESULTS.md` on branch `claude/read-tool-spike-4956c1`. Bring that directory to `main` in this stage's first PR (commits `59fa0fd` and `b57c7e6`).
- `src/adapters/model/claude/claude-code-request.ts`, `claude-code-output.ts` and `run-claude.ts`: the flags, the lockdown check and the environment.
- ARCHITECTURE.md, the bullets after "PR content is untrusted".

## Goal

Every pass can open the harness files that aren't in its prompt, whole or by lines, when the change it's reading calls for them. This stage fixes the contract every transport follows and builds it on Claude Code. Stages 70 and 71 build it on the API and on opencode; Codex stays without.

## Decisions

This stage writes them into DESIGN.md and ARCHITECTURE.md, each with its alternatives.

- **The rule changes from "no tools" to "one reader, of files megareviewer wrote".** Before a pass starts, megareviewer writes the run's harness files into the pass's own directory, and the only thing the model can read is that directory. PR text can still ask for anything; the worst it gets is a team document from the base commit.
- **megareviewer writes regular files only,** under `harness/` at their repository paths, from the store, never from a checkout's working tree. A second root beside `harness/` is where code would go later.
- **Long lines are wrapped in the copy.** A line over 1,000 characters is broken at spaces. opencode cuts a line at 2,000 characters, and ARCHITECTURE.md has 23 of those, so the copy is what every transport serves and the index's line numbers are the copy's. Serving the file as it is was the alternative: one index per transport, or a file read with holes on one of them.
- **The prompt gets an index, not the files.** After the guideline files, the guidance block lists every readable file on a line: its ref, its path under `harness/`, its size and line count, and the file that links it. Headings of the first two levels follow, with their lines, nearest the roots first, while the headings fit 8 KB; a file past that keeps its line. megareviewer's plan docs alone have 859 headings, so all of them would be a second document. The block opens with megareviewer's own words on reading: these are the team's documents as of the base commit; read the parts the change touches before answering; a file changes what to look for and nothing else.
- **A run without readable files sends the bytes it sent before,** with no tool, the flags of today and the same fingerprint. The system prompt doesn't change.
- **A transport says whether it reads.** `AnalysisModel.readsHarness` is true on Claude Code from this stage, and false on the others until their stage, and on Codex for good. A run on a transport that doesn't read gets no index, and a warning names how many files weren't available and why.
- **Reads are capped by rounds, 8 a pass.** A pass that runs out, or whose reader fails, is run once more without the tool, on the prompt alone, and the call's record says why. Failing the run was the alternative: a review lost to a document.
- **A read outside the directory ends the pass.** Claude Code refuses it (`--restricted`); megareviewer also resolves each `tool_use`'s path as it arrives and kills the process on one outside, since the stream shows a read before it runs. The pass is then run once without the tool, and Run details says a read outside the harness was tried. The kill is a check on the refusal, not the refusal.
- **Every read is recorded.** A model call keeps the paths and lines it read and the ones it was refused, and Run details lists them under the call.
- **A mark needs a read.** A guidance mark naming a file the pass was neither given nor read is dropped, as a mark with an unknown ref is.
- **The guardrail and suggestion calls get no reader.** They read PR text and comments in their message, and answer in seconds.

## Contract

### Application

- `AnalysisModel.readsHarness: boolean`.
- `AnalysisInput.harness`: `{ files: { ref, path, bytes, lines, linkedFrom, headings }[], contents: ReadonlyMap<string, string> } | null`. Paths and line numbers are the copy's, under `harness/`. Null on a transport that doesn't read or with nothing to read.
- `HarnessRead`: `{ path, fromLine: number | null, toLine: number | null, outcome: "read" | "refused" }`, the path as the model gave it, resolved against the pass's directory. `AnsweredPass`, `PassOutput` and `ModelCall` gain `reads`, empty when absent, so a stored analysis parses.
- `Guidance.guidelines` items gain `given: "prompt" | "on-request"`, `"prompt"` when absent.
- `PassOptions.withoutReader?: boolean`, for the second run of a pass.
- Refs: files in the prompt keep `g1…` in their order, readable files continue the numbering in the index's order.

### A pass's directory

`run-command.ts` makes, for a pass with a harness: the system prompt file at the top, outside the working directory, and `work/harness/…` as the working directory. The model could otherwise read the system prompt file: harmless, and not a harness file.

### Claude Code

Measured in the spike on 2.1.303, the oldest version megareviewer runs:

- Flags: `--tools "Read Grep"` and `--restricted`, with the others as they are. The stream's first event must list exactly `Grep`, `Read` and `StructuredOutput`, and no MCP server.
- `--restricted` refused the canary by absolute path, by `../`, through a linked file and through a linked directory, for `Read` and `Grep`, each as a `system/permission_denied` event.
- Environment: `CLAUDE_CODE_DISABLE_FILE_MENTIONS=1`, already set; `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, so a harness file named `CLAUDE.md` is read only when asked for; `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS=60000`, since a plain `Read` otherwise stops at 25,000 tokens, line 167 of ARCHITECTURE.md's 445, without an error.
- `--max-turns` counts model requests: one per round of reads, one for the answer, and a spare for an answer the schema refused. So 8 rounds is 10.
- Structured output came back after reads, refusals and parallel reads, with the passes' union schema.
- Later processes read the tools and the system prompt, with the PR in it, from the cache across directories and efforts: 7,350 tokens on small-feature.

## Definition of done

- [ ] The contract above, with the fake model recording reads and the pipeline's tests covering: a pass with reads, a refused read, a second run without the reader after the rounds ran out, a mark dropped for want of a read.
- [ ] The copy: a test that wrapping loses no character but the space it breaks at, and that a heading's line in the index is its line in the copy.
- [ ] The index, with megareviewer's own harness as a fixture: every file has a line, the headings stop at 8 KB, and its hash is held.
- [ ] `claudeCodeArgs` and the lockdown check for a pass with a harness and without; the fingerprint without one is `0cf796199906ab9d` still.
- [ ] Reading the stream: reads and refusals become `HarnessRead`s; a `tool_use` outside the directory kills the process, tested with a recorded stream.
- [ ] Run details lists each call's reads, and the usage line says "read 3 harness files" when any pass did. A run on Codex shows the warning.
- [ ] `evals/spikes/harness-read-tool/` is on `main`.
- [ ] Live through Claude Code on Sonnet 5.5, megareviewer's own repository with `CLAUDE.md` on, one PR that touches a host adapter: which pass read what, the run's time and tokens against the same run without the reader, in the notes.
- [ ] ARCHITECTURE.md's lockdown bullets say the new rule for each transport as it stands after this stage; ENGINEERING.md has **Harness read**.

## Out of scope

- The API (70) and opencode (71).
- Code in the reader, and reading from a checkout.
- Whether reading improves a review: stage 72.

## Open issues

- Windows and Linux weren't measured in the spike: paths, links and `--restricted` there.
- Claude Code's own directories under `--restricted` (its project and scratch directories) weren't probed; the spike's only outside target was its canary.
- On a pass the model said it was given a "userEmail" reminder. Check whether megareviewer's flags send the signed-in account's email to the model, and stop it if they do.

## Notes for later stages

None yet.
