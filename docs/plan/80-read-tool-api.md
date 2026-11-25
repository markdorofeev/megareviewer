# Stage 80: The read tool on the Anthropic API

Planned and committed as stage 70.

**Status:** Done on `claude/harness-core-4b758f` (`70c5f84`, `9f093c0`, `aafa981`, `ae80751`). `pnpm check`: 214 test files, 4,324 passed, 6 skipped, no dependency violations.
**Depends on:** 79
**Owns:** the API transport in `src/adapters/model/claude/` (`request.ts`, `claude-analysis-model.ts`, `message.ts`, their fixtures), `evals/claude-live-check.ts`

## Read first

- [Stage 79](79-read-tool.md): the contract, `AnalysisInput.harness`, `HarnessRead` and the rules on rounds and on a second run without the reader.
- The spike's results, section 11.
- `src/adapters/model/claude/request.ts`: `passRequest`, where the cache breakpoints are and why effort is a system message.
- The `claude-api` skill, for tool use, streaming and cache breakpoints, before changing the request.

## Goal

A pass through the API reads harness files with a tool megareviewer serves itself. There's no file system in it: the tool answers from the contents the run was given, so nothing outside them can be reached.

## Decisions

- **One custom tool, `read_file`,** taking a path and optional first and last lines, defined the same on every pass of a run with a harness, and not at all on a run without, whose requests stay byte for byte what they are. The tool is ahead of the PR in the cached prefix: in the spike a pass without it read nothing from the cache a pass with it had written.
- **megareviewer serves it from `AnalysisInput.harness.contents`.** A path that isn't there gets an error as the tool's result, naming nothing but the path asked for, and is recorded as refused. Nothing is killed: no read can go wrong.
- **A loop of rounds, at most 8,** each a streamed request. The answer is the text of the request that ends the turn, read as today. Past the last round the pass is run once without the tool, as stage 79 says.
- **What a round read is cached for the next.** A breakpoint goes on the last tool result of each round, within the API's limit of four with the ones the request has. Without it, a large file read in round 1 is paid in full in every round after: only the PR had a breakpoint in the spike.
- **`onAnswering` fires on the first event of the first round,** which is when the PR is in the cache, as now.
- **Usage is summed over the rounds,** and the size check counts the tool with the request.

## Definition of done

- [x] `passRequest` with a harness and without: the second has the hash it has today.
- [x] The loop, on recorded messages: one read then an answer, parallel reads in one round, a refused path, the rounds running out, a range of lines, and a file read whole.
- [x] A test that every pass of a run sends the same tool definition, and that the breakpoints never number more than four.
- [x] `readsHarness` is true on the API.
- [x] `evals/claude-live-check.ts` runs all four passes with a harness on Haiku 5.5, and reports for each round the tokens written to and read from the cache. Run it and write the numbers into the notes: the later passes read the PR from the cache, and round 2 reads round 1's file from it.

## Out of scope

- The API's own file or code tools: megareviewer serves the one tool it defines.

## Notes for later stages

### Where the code differs from the decisions above

- **Eight rounds of reading, then the answer:** nine requests at most, as on Claude Code. A ninth request that asks for a file is the `reader` failure.
- **A round's breakpoint lasts three rounds.** The PR has one of the four, so the latest three rounds keep theirs. What an older one wrote is still read, through a later one.
- **Two more failures are the reading's:** the API refusing a later round's request (400 or 413), since it took the same request without what was read, and a context window that fills after a read. A later round's refusal, output limit, rate limit or network error keeps its own kind, with the reads so far.
- **Lines that don't exist are refused,** with the ones there are; a last line past the end is the end. A use that names no file is answered with an error and not recorded, as on Claude Code.
- **A path has to be the index's own,** `harness/docs/rules.md`; `./harness/…` and `docs/rules.md` are refused.
- **`PROMPT_VERSION` stays 17,** since a run without a harness sends what it did; one with something to read has its own fingerprint, `READER_FINGERPRINT`, as Claude Code's does.
- **The tool isn't `strict` and doesn't stream its input eagerly.** Its input is a path and two numbers, and the server checks it.

### Outside the paths this stage owns

`src/adapters/model/shared/errors.ts` has `readerFailed`, `roundsUsedUp` and `readTooMuch`, so both transports say them in the same words; `claude-code-call.ts` takes them from there, with no change in what it does.

### Live, on 2026-11-25, Haiku 5.5

`node evals/claude-live-check.ts --harness --record`, once: `small-feature` with seven files to read, where only the first says which of the others has the rules. All five passes, the tour's steps among them, read that file, then two others side by side, then answered. $0.017 in all.

| Pass | Round 1: in, read from and written to the cache | Round 2 | Round 3 |
|---|---|---|---|
| Intent | 1,562, 0, 5,132 | 2, 5,132, 2,939 | 2, 8,071, 1,965 |
| Risk | 2,097, 5,132, 0 | 2, 5,132, 3,544 | 2, 8,676, 1,978 |
| Decisions | 1,230, 5,132, 0 | 2, 5,132, 2,629 | 2, 7,761, 1,993 |
| Steps | 833, 5,132, 0 | 2, 5,132, 2,230 | 2, 7,362, 1,945 |
| Findings | 2,094, 5,132, 0 | 2, 5,132, 3,549 | 2, 8,681, 1,946 |

- The four later passes read the tool, the system prompt and the PR from the cache, 5,132 tokens.
- Round 1's file is in round 2's request, which writes it to the cache, and round 3 reads it from there, with the task and the thinking before it. A pass that answers in round 2 pays the write, 1.25 times the input price, for nothing.
- Haiku read what the line after the task asked for in every pass, where on Claude Code with Sonnet only the decisions pass has. The harness here is made to be followed, so it says nothing of how often a real one is read; that's 82's.

### Open

- Run live on Haiku only. Sonnet and Opus take the same request without the tool, but the read loop hasn't run on them.
