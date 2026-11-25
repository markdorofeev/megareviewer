# Stage 81: The read tool on opencode

Planned and committed as stage 71.

**Status:** In progress (branch claude/harness-second-8cfed6)
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

- [ ] The session's request with a harness and without: the second is what it is today, and the fingerprint without one is `6f77c495527ff5c6` still.
- [ ] `readTurn` on recorded sessions: reads then an answer, a refused read, an unexpected tool, a nested `AGENTS.md` inside the harness and one outside, messages over more than one page.
- [ ] A run's passes get the same directory, and it's gone after the run, a failed run too.
- [ ] `readsHarness` is true on opencode.
- [ ] Live on 2.3.0 through one Anthropic model: megareviewer's own repository with `CLAUDE.md` on, the reads each pass made, and the cache tokens each later pass read, in the notes.

## Open issues

- The spike ran one provider, Anthropic. Another provider's models may call `read` differently or not at all.
- The copy's wrapped lines (stage 79) should mean opencode cuts none at 2,000 characters; confirm it on ARCHITECTURE.md's copy.

## Notes for later stages

None yet.
