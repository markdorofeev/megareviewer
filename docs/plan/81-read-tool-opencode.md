# Stage 81: The read tool on opencode

Planned and committed as stage 71.

**Status:** Done on `claude/harness-second-8cfed6` (`51c1957`, `ff58bfc`, with the core track merged in `47075ea`). `pnpm check`: 220 test files, 4,420 passed, 6 skipped, no dependency violations. Playwright: 90 passed.
**Depends on:** 79
**Owns:** `src/adapters/model/opencode/`

## Read first

- [Stage 79](79-read-tool.md): the contract and a pass's directory.
- The spike's results, sections 8 to 10: the permission vocabulary, what confined a read and what didn't, and the cache.
- `src/adapters/model/opencode/opencode-request.ts` and `opencode-output.ts`: the agent's deny-all rule and `readTurn`.

## Goal

A pass through opencode reads harness files with opencode's own `read`, allowed for the run's files and nothing else.

## Decisions

All measured in the spike on opencode 2.3.0.

- **One allow rule per harness file, in the session's permissions.** The agent keeps its deny-everything rule; the session adds `{ action: "read", resource: <file>, effect: "allow" }` for each file megareviewer wrote. Allowing `read` on everything in the directory was the alternative, and read the canary through a link: megareviewer writes no links, but the list doesn't rest on that.
- **No `grep`.** Its rule takes a pattern, not a path, and it read the canary through a link while `read` on the same link was refused.
- **One directory for a run, not for a pass.** opencode puts the session's directory in the system prompt ahead of the PR, so sessions in different directories share no cache: 1,803 tokens read where the same directory read 5,245. The run's passes share one harness directory, made before the first and removed after the last.
- **`readTurn` reads a turn of several messages.** It asks for the messages oldest first, follows the pages to the end, and takes the answer from the last assistant message. A tool item is allowed when it's `read` on a path of the harness, and becomes a `HarnessRead`, a refusal included; anything else fails the pass as now.
- **A nested `AGENTS.md` that loads itself counts as a read.** Reading a file with an `AGENTS.md` beside it puts that file in the context as a synthetic message. It's allowed only when its path is a harness file, and recorded as a read of it. Renaming such files in the copy was the alternative: the links to them would then name nothing.
- **The check is on the turn, not a kill.** opencode shows a read once the session is idle. A read outside the harness that somehow went through fails the pass and discards its answer, as any tool does today.
- **A whole file takes several reads.** opencode pages at about 50 KB, so ARCHITECTURE.md is 4 reads. The cap on rounds is stage 79's; a pass that needs more reads the part it needs by lines.

## Definition of done

- [x] The session's request with a harness and without: the second is what it is today, and the fingerprint without one is `6f77c495527ff5c6` still (now `76348cab00accff5`, see the notes).
- [x] `readTurn` on recorded sessions: reads then an answer, a refused read, an unexpected tool, a nested `AGENTS.md` inside the harness and one outside, messages over more than one page.
- [x] A run's passes get the same directory, and it's gone after the run, a failed run too.
- [x] `readsHarness` is true on opencode.
- [x] Live on 2.3.0 through one Anthropic model: megareviewer's own repository with `CLAUDE.md` on, the reads each pass made, and the cache tokens each later pass read, in the notes.

## Open issues

- The spike and the live run are one provider, Anthropic, on Haiku 5.5. Another provider's models may call `read` differently or not at all.
- The cap on rounds was never reached live: it's tested on a fake session that asks for a ninth.
- Nor was a read outside the directory through megareviewer's own runner; the refusals tested are the spike's recordings.

## Notes for later stages

### Where the code differs from the decisions above

- **The fingerprint without a harness is `76348cab00accff5`,** `main`'s since stage 79's merge, and it hasn't moved. A run with something to read has its own, `OPENCODE_READER_FINGERPRINT`, and `OPENCODE_PROMPT_VERSION` stays 11, as Claude Code's and the API's did.
- **The directory is there while a pass of the run is.** Nothing tells an adapter that a run starts or ends, and one model serves every run, so a directory belongs to a run's `InputHarness`: the first pass makes it, the last one running removes it, and a later pass has it written again at the same path, so the cache holds. It's made again only where nothing is, and otherwise the pass runs without the reader.
- **The rounds are capped by looking at the session every 2 seconds** while it runs, and interrupting it at the ninth message that calls a tool. opencode's own `steps` can't be used: its last step prefills the answer, which Haiku 5.5 refuses (stage 53's `provider-error.json`). A pass that has answered by then keeps its answer.
- **A session's messages show while it runs,** so a read outside could be an interrupt as well as a check afterwards. Left as decided: the permissions refuse it, and the answer is discarded.
- **More than reading the harness is a `reader` failure,** as on Claude Code, so the pass runs once more without the reader: another tool, a message opencode adds that isn't a harness file's, and a read outside the directory, refused or not. Without a harness it's what it was. A refused read inside, of a file that isn't there, is recorded and the pass goes on.
- **The provider refusing a later round (400 or 413), or the context filling after a read, is the reading's failure,** as on the API; a rate limit, an overload, a refusal and the output limit keep their own kinds, with the reads so far.
- **The messages are followed to an empty page:** opencode 2.3.0 gives a cursor past the last message too. A session over 50 pages can't be checked, so it fails.
- **opencode cuts no line of the copy:** ARCHITECTURE.md has 25 lines over 2,000 characters and its copy none over 1,000.

### Live, on 2026-11-25, Haiku 5.5 through opencode 2.3.0's Anthropic provider

`8d79787..57aceb4` of this repository, as in stages 77 and 79, with `CLAUDE.md` on and the harness from GitHub, through stage 76's source: 4 files in the prompt and 69 to read. One run, without the tour, $0.27 in all.

| Pass | Time | Reads | Read from the cache | Written to it | Cost |
|---|---|---|---|---|---|
| Intent | 20.7 s | `ARCHITECTURE.md` lines 126–149, Credentials | 175,886 in two requests | 178,161 | $0.131 |
| Findings | 42.0 s | none | 174,257 | 1,953 | $0.032 |
| Decisions | 44.0 s | `docs/plan/06-bitbucket-adapter.md`, whole | 349,811 in two requests | 6,430 | $0.045 |
| Risk | 36.7 s | none | 174,257 | 2,164 | $0.031 |
| Risk, its retry for two hunks left out | 34.5 s | none | 174,257 | 2,250 | $0.029 |

- All five sessions ran in one directory, and nothing was left of it after the run. Each later pass read the PR and the index from the cache.
- The change is to how the Bitbucket adapter asks who the user is, and the reads are of Bitbucket's credentials and its adapter's plan. There were no findings; the risks' marks weren't looked at.
- No `AGENTS.md` loaded itself, the repository having none.

### The merge

`claude/harness-core-4b758f` at `659fb3f` merged into this branch without a conflict (`47075ea`). The reader errors are `shared/errors.ts`'s.

### To fold into ARCHITECTURE.md when the slice is merged

- Model passes and the lockdown bullets say opencode's passes have no reader, a denied tool and one answer; an **On opencode** paragraph in "Reading the harness" would say the directory, the rules by file, the look every 2 seconds and the check on the turn.
- "a transport that reads them … Claude Code today" is three transports now; Codex is the one without.
