# Stage 55: Preferences: the domain, the store, the API and the run's guidance

**Status:** In progress (branch claude/local-preferences-feature-07de4b)
**Depends on:** 43, 45, 51, 54
**Owns:** `src/domain/review/preference.ts` and the guidance fields of `point.ts`, `risk.ts` and `analysis.ts`; the `PreferenceStore`, `PreferenceSuggester` and `ReviewHistory` ports, `ModelCatalog.suggester`, `AnalysisInput.guidance`, their fakes and contract suites; the preference tables and store in `src/adapters/sqlite/`; `src/application/use-cases/preferences.ts`, the guidance of a model run in `run-pipeline.ts` and `model-passes.ts`, the signals in `review.ts` and `threads.ts`; the preference routes in `contracts/api.ts` and `src/adapters/http/`; their wiring in `src/cli/compose.ts` and `src/cli/dev/fake-app.ts`; the feature's text in DESIGN.md, ARCHITECTURE.md and ENGINEERING.md

## Goal

An AI review says the same things to every reviewer. A reviewer who never wants a comment about naming gets one on every PR, and one who cares most about tenant isolation has to hope Claude thinks of it. This slice lets megareviewer learn what a reviewer values and use it in Request AI review.

It collects that from four places, all on the reviewer's machine:

1. **What the reviewer writes:** rules, "Look for" or "Don't flag", for every repository or for one.
2. **What the reviewer does:** the points they dismiss and raise and the comments they post are recorded, and become proposed rules, at the point ("Don't flag things like this") or on request ("Suggest from my reviews", one model call).
3. **The repository's guideline files:** `REVIEW.md` and the like, read at the PR's base commit, the ones the reviewer switches on.
4. **Past reviews on the host:** the reviewer's own comments on recent PRs of a repository, on request, as proposed rules.

Nothing learned is used until the reviewer accepts it. This stage builds everything but the prompts (56), the hosts' history (57), the page (58) and the evals (59), and leaves them a contract to build on side by side.

## Decisions

These are the reviewer's answers from the interview and what follows from them. This stage writes them into DESIGN.md and ARCHITECTURE.md, each with its alternatives, in the documents' own voice.

- **A preference is a rule, not a note.** One short sentence, with a kind, **Look for** or **Don't flag**, a scope, everywhere or one repository, a source (written, learned, imported) and a switch. Free-text notes per scope, like a CLAUDE.md, were the alternative: a point couldn't then say which preference shaped it, and a learned proposal would be a line appended to prose.
- **Global and per repository, both sent.** A run reads the enabled preferences for everywhere, then the PR's repository's. Global only leaks one codebase's rule into another; per repository only makes the reviewer write "no naming nits" in each.
- **Preferences change what's flagged, the risks and decisions, and the brief. Not the wording of comments.** A comment posts under the reviewer's name and they edit it before it does.
- **Learned means proposed.** megareviewer never turns what the reviewer did into a rule by itself. A proposal says what it would add and what it's based on, and the reviewer accepts it, edits it or rejects it. Applying learned rules at once, with a page to remove them, was the alternative: a review that changed and didn't say why. Sending the last dismissed and raised points as examples was the other: nothing the reviewer can read or correct.
- **Two ways to learn.** At the point: Dismiss has "Don't flag things like this", which opens a rule drafted from that point for the reviewer to word and save, with no model call. On request: "Suggest from my reviews" reads the recorded signals in one model call and proposes rules. A call after every publish was the alternative: a model call nobody asked for, on the reviewer's plan.
- **Signals are recorded, not derived.** A dismissed or raised point is in `point_reviews`, but its text is in the analysis, where Remove AI review takes it away and a new run reuses its ID. So a signal is a row of its own with the point's text as it was: `dismissed`, `raised`, or `comment` for a line comment the reviewer posted. Deriving them from `point_reviews` and the analyses, as the review activity is derived, was the alternative. A signal is keyed by what made it (the analysis and point, or the publication and comment), so a retry writes it once, and reopening a point removes its signal.
- **Past host reviews: the reviewer's own, on request, per repository.** Everyone's comments were the alternative: the team's habits, which aren't this reviewer's preferences. Reading them at the first review of a repository was the other: requests and a model call nobody asked for.
- **Guideline files are detected, and the reviewer switches them on.** megareviewer looks for `REVIEW.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` and `.github/copilot-instructions.md` at the root; `REVIEW.md` is on unless switched off, the others off unless switched on, since they're about writing code and can be long. They're read at the PR's **base** commit, from the host through the file cache, so a PR can't rewrite the rules it's reviewed by and no checkout is needed. A file over 32 KB isn't sent, and the page says so: cutting it would be silent truncation.
- **"Don't flag" folds, it doesn't hide.** Claude still reports a finding or risk a "Don't flag" preference matches, marked as left out, and the page shows it folded to one line with the preference and Show. Not reporting it was the alternative: cheaper, and the reviewer never learns what a rule removed, or that it's too wide. Keeping only major and blocking ones was the other.
- **A point says which preference shaped it.** "From your preference: check tenant isolation", or "From REVIEW.md". The run records the guidance it used, so the mark stays right after the preference is edited or deleted.
- **A mark that doesn't check out is dropped, never the point.** A guidance mark naming a preference the run didn't have, or "left out" by a Look for preference, loses the mark and shows as any other point: unsure, the page shows more.
- **Preferences can't touch the safety rules.** They steer what to look for and leave out. Text in a PR aimed at an automated reviewer is still a finding, a mechanical proof is still the code's, and a path rule's contract still orders the tour. Proposals come from a model reading point titles, which come from PR text, so a PR could try to plant a rule; a proposal is only ever text the reviewer reads and accepts.
- **At most 50 enabled preferences per scope.** The API refuses to enable more, with a message. Sending the first 50 of more would drop the rest silently.
- **Suggesting and importing are one request each, not a run with events.** One model call of some seconds, whose result is the response. A run with stages and SSE, as an analysis has, was the alternative for a call with one stage.

## Contract

Other stages build on these names. Follow the existing patterns for IDs, timestamps and schemas (`AnalysisId`, `Timestamp`, Zod, `readonly`).

### Domain: `src/domain/review/preference.ts`

- `PreferenceKind`: `"look-for" | "dont-flag"`.
- `PreferenceScope`: `{ kind: "global" }` or `{ kind: "repo", repo: RepoRef }`.
- `PreferenceSource`: `"written" | "learned" | "imported"`.
- `Preference`: `{ id: PreferenceId, kind, text, scope, source, enabled, createdAt, updatedAt }`. `text` is trimmed, 1 to 300 characters.
- `PreferenceProposal`: `{ id: ProposalId, kind, text, scope, source: "learned" | "imported", evidence: string[], status: "pending" | "accepted" | "rejected", createdAt }`. `evidence` is at most 5 short lines saying what it's based on ("Dismissed: Missing JSDoc on `parseConfig`, acme/api #12").
- `ReviewSignal`: `{ kind: "dismissed" | "raised" | "comment", at: Timestamp, pullRequest: PullRequestRef, pointKind: PointKind | null, title: string, text: string, path: string | null }`. For a point, `title` and `text` are its title and explanation; for a comment, `title` is empty and `text` its body.
- `PastComment`: `{ pullRequest: PullRequestRef, path: string | null, body: string, at: Timestamp }`.
- `GUIDELINE_PATHS`, `DEFAULT_GUIDELINE_PATH = "REVIEW.md"`, `MAX_GUIDELINE_BYTES = 32_768`, `MAX_ENABLED_PREFERENCES = 50`.
- `GuidelineFile`: `{ path, bytes, enabled, tooLarge }`.
- `GuidanceRef`: `/^[pg][1-9][0-9]*$/`: `p1` the run's first preference, `g1` its first guideline file.
- `Guidance`, what one model run used, kept on the analysis: `{ preferences: { ref, id: PreferenceId, kind, text, scope }[], guidelines: { ref, path, bytes }[] }`.
- `GuidanceMark`, on a finding and a model risk: `{ ref: GuidanceRef, effect: "raised" | "left-out" }`.
- Pure functions: `preferencesFor(preferences, repo)` (enabled, global first, then the repository's, each in creation order); `guidanceOf(preferences, guidelines)` which numbers them; `checkGuidanceMark(mark, guidance)` which returns the mark or null (unknown ref; `left-out` on a look-for preference; `raised` on a dont-flag one; a guideline file takes either).

### Domain: changes

- `Finding.guidance: GuidanceMark | null`, default null. `RiskAssessment` and the port's `ModelRisk` the same.
- `Analysis.guidance: Guidance | null`, default null, set when a model run starts and cleared by Remove AI review.
- `Point.guidance?: { effect: "raised" | "left-out", label: string, preferenceId: PreferenceId | null }`: `label` is the preference's text or the guideline file's path. `pointsOf` takes the analysis's `guidance` and resolves marks with `checkGuidanceMark`; findings and risks only.
- Stored analyses parse unchanged.

### Ports

- `PreferenceStore` (`src/application/ports/preference-store.ts`): preferences (list, save as upsert, delete), proposals (list, save), signals (`recordSignal(key, signal)` as upsert, `removeSignal(key)`, `listSignals(limit)` newest first, `countSignalsSince(at | null)`), guideline switches per repository (`getGuidelineSwitches(repo)`, `setGuidelineSwitch(repo, path, enabled)`), and when suggestions last ran (`getLastSuggestionAt`, `recordSuggestionAt`). The store's clock stamps nothing here: timestamps come in on the values.
- `PreferenceSuggester` (`src/application/ports/preference-suggester.ts`): `suggest(input: SuggestionInput): Promise<Result<PassOutput<ProposalDraft[]>, ModelError>>`, with `SuggestionInput = { signals, comments, preferences, rejected, repo: RepoRef | null }` and `ProposalDraft = { kind, text, scope: "global" | "repo", evidence: string[] }` as a Zod schema, since model output is parsed. `repo` is the repository an import reads; null when suggesting from signals, where a draft's `"repo"` scope isn't allowed unless every signal in its evidence is from one repository (the use case resolves it, and falls back to global).
- `ModelCatalog.suggester(optionId): PreferenceSuggester | null`, as `model(optionId)`.
- `ReviewHistory` (`src/application/ports/review-history.ts`): `{ host, getReviewerComments(repo, { pullRequests: number }): Promise<Result<{ comments: PastComment[], pullRequests: number }, HostError>> }`: the current user's own comments on the code of the most recently updated PRs of `repo` they reviewed, newest first.
- `AnalysisInput.guidance: { preferences: { ref, kind, text, scope: "global" | "repo" }[], guidelines: { ref, path, content }[] }`, both empty when there's none.
- `AppDeps` gains `preferences: PreferenceStore` and `history: Partial<Record<HostKind, ReviewHistory>>`.
- Fakes for each in `src/application/testing/`, and a contract suite for `PreferenceStore` (the in-memory fake and SQLite both pass it) and for `ReviewHistory` (the fake passes it; stage 57's adapters will).

### Storage

One new migration: `preferences`, `preference_proposals`, `review_signals` (primary key the signal's key), `guideline_switches` (host, owner, repo, path, enabled), and the last suggestion time. None references `analyses`: a signal outlives its analysis.

### Use cases

`src/application/use-cases/preferences.ts`:

- `getPreferences()`: the preferences, the pending proposals, a section per repository, and how many signals were recorded since the last suggestions. Repositories are those of the 50 most recently analyzed PRs and those with a preference. A repository's guideline files are read at the base commit of its most recent analysis, through the file cache; none analyzed yet, or a failed read, is `guidelineFiles: null` with the reason.
- `addPreference`, `updatePreference` (kind, text, scope, enabled), `deletePreference`. Enabling past `MAX_ENABLED_PREFERENCES` in a scope is a `bad-request` with a message.
- `suggestPreferences(optionId?)`: with no signals, a `bad-request` saying so. Reads the last 200 signals, every preference and the rejected proposals, calls the suggester on the option (the default when none, as `runModel` picks it), saves the drafts as pending proposals with source `learned`, records the time. An option that can't run answers `model-unavailable` with its reason.
- `importPreferences(repo, optionId?)`: the host's `ReviewHistory` for the last 30 PRs; no history adapter for the host is `bad-request`. No comments is an empty result, with no model call. Otherwise the suggester, source `imported`, scope the repository unless the draft says global.
- `decideProposal(id, { decision: "accept" | "reject", kind?, text?, scope? })`: accepting makes a preference with the proposal's source and whatever the reviewer changed.
- `setGuidelineSwitch(repo, path, enabled)`.

Elsewhere:

- **A model run's guidance** (`run-pipeline.ts`): before the passes, read `preferencesFor(…, repo)` and the repository's guideline files at `pullRequest.baseSha` (the paths found, switched on, not too large), put them in `AnalysisInput.guidance` and save `Analysis.guidance` with the run's option. Guideline files that can't be read are a warning on the analysis, and the run goes on without them.
- **Checking marks** (`model-passes.ts`): a finding's or risk's mark that `checkGuidanceMark` refuses is set to null, logged, never retried.
- **Signals** (`review.ts`, `threads.ts`): `recordPointState` writes `dismissed` or `raised` with the point as `pointsOf` gives it, keyed by analysis and point, and removes it on `open`; a failed signal write never fails the state. Publishing writes a `comment` signal per line comment the host accepted, keyed by analysis, publication number and comment key; Comment now writes one too.

### HTTP API (`contracts/api.ts`)

| Route | Request | Response |
|---|---|---|
| `GET /api/preferences` | | `PreferencesView`: `{ preferences, proposals, repositories: { repo, guidelineFiles: GuidelineFile[] \| null, guidelineNote: string \| null }[], signalsSinceSuggestion: number }` |
| `POST /api/preferences` | `{ kind, text, scope, source?: "written" \| "learned" }` | `Preference` |
| `PUT /api/preferences/:preferenceId` | `{ kind?, text?, scope?, enabled? }` | `Preference` |
| `DELETE /api/preferences/:preferenceId` | | `{}` |
| `POST /api/preferences/suggestions` | `{ optionId? }` | `{ proposals: PreferenceProposal[], signals: number }` |
| `POST /api/preferences/imports` | `{ repo, optionId? }` | `{ proposals: PreferenceProposal[], comments: number, pullRequests: number }` |
| `PUT /api/preferences/proposals/:proposalId` | `{ decision, kind?, text?, scope? }` | `{ preference: Preference \| null }` |
| `PUT /api/preferences/guidelines` | `{ repo, path, enabled }` | `{}` |

`source: "learned"` on `POST /api/preferences` is the rule saved from "Don't flag things like this". `AnalysisView` carries `guidance` with the analysis.

### Wiring

- `src/cli/compose.ts`: the SQLite preference store; `history` empty until stage 57. The real catalog's `suggester` returns null until stage 56, so suggesting answers `model-unavailable`.
- `src/cli/dev/fake-app.ts`: the in-memory store, a fake suggester that answers two fixed drafts, and a fake history with three comments, so stage 58 has a server to build and test against.

### Ubiquitous language (ENGINEERING.md)

Preference, Preference proposal, Review signal, Guideline file, Guidance.

## Definition of done

- [ ] The domain types and pure functions, with tests; `pointsOf` resolves marks, and drops one that doesn't check out while keeping its point.
- [ ] `PreferenceStore` in memory and on SQLite, both passing one contract suite; the migration test covers the new tables.
- [ ] Every use case above, with tests on fakes: the cap, a suggestion with no signals, an option that can't run, an import with no comments, accept with edits, reject, a run's guidance snapshot, guideline files too large or unreadable, signals written once on a retried publish and removed on reopen.
- [ ] The eight routes, with HTTP tests.
- [ ] A model run with preferences passes them in `AnalysisInput.guidance` and records `Analysis.guidance`; Remove AI review clears it.
- [ ] DESIGN.md has the decision with its alternatives; ARCHITECTURE.md has the storage tables, the routes' behavior and the run's guidance; ENGINEERING.md has the five terms.
- [ ] `pnpm check` passes.

## Notes for later stages

