# Stage 80: The read tool on the Anthropic API

Planned and committed as stage 70.

**Status:** In progress (branch claude/harness-core-4b758f)
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

- [ ] `passRequest` with a harness and without: the second has the hash it has today.
- [ ] The loop, on recorded messages: one read then an answer, parallel reads in one round, a refused path, the rounds running out, a range of lines, and a file read whole.
- [ ] A test that every pass of a run sends the same tool definition, and that the breakpoints never number more than four.
- [ ] `readsHarness` is true on the API.
- [ ] `evals/claude-live-check.ts` runs all four passes with a harness on Haiku 5.5, and reports for each round the tokens written to and read from the cache. Run it and write the numbers into the notes: the later passes read the PR from the cache, and round 2 reads round 1's file from it.

## Out of scope

- The API's own file or code tools: megareviewer serves the one tool it defines.

## Notes for later stages

None yet.
