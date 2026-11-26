# Stage 78: The harness on the Preferences page

Planned and committed as stage 68.

**Status:** Done on `claude/harness-second-8cfed6` (`02fe7d4`, `4702eef`, `f8a29b5`, `d4d9297`, `077f75c`, `f63f9c0`). `pnpm check`: 212 test files, 4,213 passed, 6 skipped, no dependency violations. Playwright: 90 passed.
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

- [x] The routes above, with `contracts/api.test.ts` cases and HTTP tests on the fake app's harness from stage 75.
- [x] The panel lists roots and their linked files as decided, keyboard reachable, each switch named by its file, the fold a button with `aria-expanded`.
- [x] Switching a linked file, and a root with linked files, updates the counts without a reload.
- [x] The tooltip's line in its four states.
- [x] The design-system page shows a root with linked files, folded and open, and one cut by a limit; its Playwright checks pass in the four theme and palette combinations.
- [x] `e2e/preferences.spec.ts`: open a repository, unfold a root, switch a linked file off, reload, and it's still off.

## Out of scope

- What a run reads (77, 79).
- Showing a file's content on the page.

## Notes for later stages

### Where the code differs from the contract above

- **A linked file has `use`, not `inPrompt`:** `"prompt"`, `"on-request"`, or null when a review doesn't use it, and a root has it too. With `enabled` and `inPrompt` alone the page couldn't tell a file that's on from one that's on and behind a file that's off. `enabled` is the file's own switch.
- **A linked file's `use` is with its root on.** Under a root that's off it's what the root would bring, "When on: 2 in every review, 5 on request" on its row and "When on, in every review" on a file's, even where another root already brings the file.
- **`via` and `linkedFrom` are the nearest link from that root,** not the harness's, whose first linking file can be under another root. The page says "imported" on a row linked that way.
- **The switch answers the repository's section again,** where it answered `{}`. One switch changes how other files are used, by the budget and by what it links, and working that out on the page would need the harness and its links there.
- **The section gained `harnessNote`:** that the files are loading or couldn't be loaded, so a list without links isn't read as a repository without any.
- **The page shows the repository's latest harness,** the one the switch route takes paths from, and its guideline files come from it without asking the host. When the latest pull request's load failed, the note says these are an earlier one's. Without a harness it reads the five from the file cache or the host, as before, and says of each whether it fits the prompt.
- **A guideline file another one links has no second switch:** it's listed with how it's used, or "Has its own switch", and switched on its own row. Where an enabled root imports it, that row's switch is on.
- **The tooltip's line** is also on Re-run and Try again, which run the same thing. A failed load has no line, as loading and none don't; the run loads it again and says what it couldn't read. With nothing in the prompt it says "Can read 5 guideline files on request". While it loads, the page asks again every 2 seconds.
- **"On request" doesn't depend on the chosen model.** A model option doesn't say whether its transport reads the harness, so on one that can't, the tooltip still says "66 more on request" and only the run's warning says otherwise.

### Changed outside what this stage owns

- `src/application/use-cases/guideline-files.ts` is new, the pure part of `preferences.ts`; `create-use-cases.ts` and `index.ts` list `getHarnessUse`.
- `importedRead` of `UsageFooter.tsx` is exported; `ClaudeElement.tsx` and `ReviewPage.tsx` have the tooltip's line, from `useHarness.ts`.
- `src/cli/dev/receipts-harness.test.ts` tests the routes on the fake app, since an adapter's test can't import it. `e2e/fake-server.ts` names its PR, and the mock API and fixtures in `web/dev/` have the harness.

### For the core track

- `GuidelineFile.tooLarge` has no reader on the page now. It's still in the contract, as part of the domain's type; taking it out is `preference.ts`'s.
