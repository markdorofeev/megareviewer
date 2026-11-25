# Stage 78: The harness on the Preferences page

Planned and committed as stage 68.

**Status:** Not started
**Depends on:** 75
**Owns:** the guideline parts of `contracts/api.ts`, `src/application/use-cases/preferences.ts` and `src/adapters/http/`; `web/src/pages/preferences/`; the Request AI review tooltip's line on the harness; `e2e/preferences.spec.ts`; the harness on the design-system page

## Read first

- [Stage 75](75-harness-core.md): `Harness`, `HarnessFile`, `harnessEnabled` and `harnessPlan`.
- `web/src/pages/preferences/GuidelineFiles.tsx` and `view.ts`: a repository's guideline files as the page lists them.
- ARCHITECTURE.md, "Preferences page", and ENGINEERING.md, "UI".

## Goal

The reviewer sees what a repository's harness holds and decides what an AI review may use: each root file with the files it reaches, their sizes, and a switch on each.

## Decisions

- **Linked files are listed under their root, folded.** A root's row says what it reaches, "70 linked files, 1 MB", and opens to them, grouped by the file that links each. megareviewer's own harness is 70 files, so a flat list always open would bury the preferences above it.
- **A file says how a review uses it.** "In every review" for a file the plan puts in the prompt, "Read when the model asks" for the rest. The words don't name a transport: which ones have the read tool is the run's to say (stage 79).
- **One switch a file, on unless switched off.** A linked file is used when its root is on and nothing between them is off. Off by default for links and on for imports was the first design, from before the read tool: a linked file costs a line of the index until a pass reads it, so there's nothing to save by leaving it off.
- **A root switched off shows what it would bring,** its count and size, so the reviewer knows what switching `CLAUDE.md` on means before doing it.
- **What the walk left out is said.** A harness cut at 5 hops or 200 files, and a file skipped as too large or unreadable, each have a line, as a guideline file over the limit has today.
- **The switch route takes any path of the repository's latest harness,** and refuses another with the message it has now.
- **The Request AI review tooltip names the harness in a line,** "Reads CLAUDE.md and 3 files it imports; 66 more on request", once it's loaded, and nothing while it loads or when the repository has none.

## Contract

- `GET /api/preferences`: a repository's `guidelineFiles` items gain `linked`, the files the root reaches: `{ path, bytes, via, linkedFrom, enabled, inPrompt }[]`, and the section gains `harnessCut` and `harnessSkipped`.
- `GET /api/analyses/:id/harness`: `{ status: "loading" | "ready" | "none" | "failed", inPrompt: string[], onRequest: number }`, read live, since a harness isn't part of an analysis.
- `PUT /api/preferences/guidelines`: any path of the latest harness.

## Definition of done

- [ ] The routes above, with `contracts/api.test.ts` cases and HTTP tests on the fake app's harness from stage 75.
- [ ] The panel lists roots and their linked files as decided, keyboard reachable, each switch named by its file, the fold a button with `aria-expanded`.
- [ ] Switching a linked file, and a root with linked files, updates the counts without a reload.
- [ ] The tooltip's line in its four states.
- [ ] The design-system page shows a root with linked files, folded and open, and one cut by a limit; its Playwright checks pass in the four theme and palette combinations.
- [ ] `e2e/preferences.spec.ts`: open a repository, unfold a root, switch a linked file off, reload, and it's still off.

## Out of scope

- What a run reads (77, 79).
- Showing a file's content on the page.

## Notes for later stages

None yet.
