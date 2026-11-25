# Stage 67: A run reads the linked files the author always loads

**Status:** In progress (branch claude/harness-core-4b758f)
**Depends on:** 65
**Owns:** `src/application/use-cases/guidance.ts`; `InputGuidance` in `src/application/ports/analysis-model.ts`; the guideline fields of `Guidance` in `src/domain/review/preference.ts`; the guidance block in `src/adapters/model/shared/render-input.ts` and its fixtures; the guidance cases of `evals/`; the usage line's words on guideline files in `web/src/pages/review/UsageFooter.tsx`

## Read first

- [Stage 65](65-harness-core.md): `loadHarness`, `harnessEnabled` and `harnessPlan`.
- `src/application/use-cases/guidance.ts`: `runGuidance` as it is.
- `src/adapters/model/shared/render-input.ts`: `renderGuidance`, and the test that holds a run without guidance to its hash.
- ARCHITECTURE.md, "Preferences": "In the prompt" and "Marks".

## Goal

A run on any transport, Codex included, reads the root files that are switched on and the files they import with `@`, where it read only the roots. On megareviewer's own repository, switching `CLAUDE.md` on then gives the passes `MISSION.md`, `DESIGN.md` and `ENGINEERING.md` with it, 42 KB, and leaves `ARCHITECTURE.md`, 174 KB, for the read tool of stage 69.

## Decisions

- **`@` imports are put in the prompt; links and mentions aren't.** An import is the author saying "always load this", which is what a pass's prompt is. A link is "see also", and megareviewer's reach 70 files. Everything reachable in the prompt was the alternative, 1 MB there. Nothing but the roots was the other: every pass with the read tool would then read `ENGINEERING.md` for itself and pay for it five times, and Codex would never see it.
- **One budget for what's put in the prompt, 64 KB,** in place of 32 KB a file. Roots come first, in `GUIDELINE_PATHS` order, then their imports breadth-first in the order they're written, an import's own imports after it. A file that doesn't fit what's left is passed over and the next one tried, so one large file doesn't shut out the small ones after it. The number is a start, and stage 72 measures it.
- **A file that doesn't fit is named, never cut.** The run's warning says which files weren't given and why, as the 32 KB warning does. From stage 69 on, a transport with the read tool doesn't warn: the file is read on request.
- **Each file is its own `<guideline_file>`,** with its own ref and a `linked_from` attribute naming the file that imports it, so a point says "From ENGINEERING.md" where the rule is. The attribute is written only on a linked file.
- **The system prompt doesn't change.** With a linked file, the guidance block gains one line of megareviewer's own before the files: a guideline file may link files that aren't in the block, which weren't given, so nothing is assumed about what they say. A run whose roots import nothing sends the bytes it sent before, which the hash test holds. A sentence in the system prompt was the alternative: every run's prompt would change, and every cached prompt and eval score with it, for a line most runs don't need.
- **The run joins the harness's load.** `runGuidance` awaits `loadHarness`, already running since the PR was opened. When it fails, the run reads the roots through the file cache as today, with a warning.

## Contract

- `InputGuidance.guidelines` items gain `linkedFrom: string | null`.
- `Guidance.guidelines` items gain `linkedFrom: string | null`, null when absent, so an analysis stored before parses.
- `MAX_GUIDELINE_BYTES` goes; `MAX_INLINE_BYTES` in `harness.ts` (stage 65) replaces it.

## Definition of done

- [ ] `runGuidance` gives the roots and their imports as `harnessPlan` orders them, with tests for the order, a file passed over for its size with a smaller one after it taken, a root switched off taking its imports with it, and an import switched off alone.
- [ ] A failed harness load falls back to the roots, with one warning.
- [ ] `renderGuidance` writes `linked_from` and the block's line only with a linked file. The hash of a run without guidance, and of the guided fixture with roots only, are what they were.
- [ ] A point marked from a linked file shows "From ENGINEERING.md"; `checkGuidanceMark` needs no change, and a test says so.
- [ ] The usage line reads "with 2 preferences, CLAUDE.md and 3 files it imports".
- [ ] One eval case: a rule stated only in a file a root imports, broken by the PR. Run three times on Sonnet 5.5 through Claude Code with the three guidance cases; the report says whether the mark came back on the imported file's ref.
- [ ] Live on megareviewer's own repository with `CLAUDE.md` switched on: the files given, the prompt's size, and whether each later pass read them from the cache, in the notes.

## Out of scope

- Files that aren't imported: the read tool of stage 69.
- The Preferences page (68).

## Notes for later stages

None yet.
