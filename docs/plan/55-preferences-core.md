# Stage 55: Preferences: the domain, the store, the API and the run's guidance

**Status:** Done (branch claude/local-preferences-feature-07de4b, no PR). `pnpm check` passes: 3209 tests, branch coverage 94% for the use cases and 100% for `preference.ts`; the review and main-page end-to-end tests pass on the fake server
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

- [x] The domain types and pure functions, with tests; `pointsOf` resolves marks, and drops one that doesn't check out while keeping its point.
- [x] `PreferenceStore` in memory and on SQLite, both passing one contract suite; the migration test covers the new tables.
- [x] Every use case above, with tests on fakes: the cap, a suggestion with no signals, an option that can't run, an import with no comments, accept with edits, reject, a run's guidance snapshot, guideline files too large or unreadable, signals written once on a retried publish and removed on reopen.
- [x] The eight routes, with HTTP tests.
- [x] A model run with preferences passes them in `AnalysisInput.guidance` and records `Analysis.guidance`; Remove AI review clears it.
- [x] DESIGN.md has the decision with its alternatives; ARCHITECTURE.md has the storage tables, the routes' behavior and the run's guidance; ENGINEERING.md has the five terms.
- [x] `pnpm check` passes.

## Notes for later stages

Everything in the Contract is in place under the names above, except where this section says otherwise. `pnpm check` passes. `PIPELINE_VERSION` stays `"20"`: nothing the code's stages make changed, and a stored analysis parses with `guidance: null` on itself, its findings and its risks.

### Where the code differs from the Contract

- **IDs.** `PreferenceId` is `/^pref_[0-9a-f]{16}$/` and `ProposalId` `/^prop_[0-9a-f]{16}$/`, branded as `AnalysisId` is. They're made by `preferenceId(seed, taken)` and `proposalId(seed, taken)`: a hash of the kind, text, scope and creation time, with a counter when the ID is taken. There's no source of randomness in the application, so there's no ID port.
- **`PreferenceProposal.text` has no maximum.** A preference's text is `PreferenceText`: trimmed, 1 to 300 characters (`MAX_PREFERENCE_TEXT`). A proposal's is the model's, trimmed and not empty. Accepting a proposal longer than 300 characters without a `text` in the request answers `bad-request` ("A preference is one sentence of at most 300 characters") and leaves it pending. Stage 56's prompt should ask for 300 characters at most; stage 58's Accept should open the form on that answer.
- **`PreferenceSuggester.suggest` answers `SuggestionOutput`, not `PassOutput<ProposalDraft[]>`:** `{ value: readonly ProposalDraft[]; usage: Omit<ModelUsage, "pass"> }`. `ModelUsage.pass` is one of the four passes, and this call is none of them. `ProposalDraft` is the Zod schema `{ kind, text: string, scope: "global" | "repo", evidence: string[] }`, loose on purpose: the use case trims the text, leaves out a blank draft, and keeps the first 5 lines of evidence that aren't blank.
- **`ReviewHistory.getReviewerComments` answers `ReviewerComments`:** `{ comments: readonly PastComment[]; pullRequests: number }`, the shape the Contract gives, under a name.
- **`AnalysisInput.guidance` is `InputGuidance`,** exported from the ports with `NO_GUIDANCE`, the empty one. `buildAnalysisInput` takes an optional `guidance` and puts `NO_GUIDANCE` without it.
- **`GuidanceRef` isn't branded,** so a fixture or an eval case writes `"p1"` as it is. `GuidanceEffect` (`"raised" | "left-out"`) and `GuidelinePath` (the enum of `GUIDELINE_PATHS`) are exported too; `GuidelineFile.path` is a `GuidelinePath`.
- **More pure functions than listed,** all exported from `src/domain/review/index.ts`: `resolveGuidanceMark(mark, guidance)`, which answers what `Point.guidance` holds (`PointGuidance`: effect, label, preferenceId) or null, and which `checkGuidanceMark` is built on, both taking null for either argument; `canEnable(preferences, scope, except?)`; `guidelineEnabled(path, switches)` and `guidelineFile(path, content, switches)`; `inCreationOrder`; `evidenceRepo(evidence, repos)`; `sameRule`, `sameRepo`, `sameScope`.
- **Signal keys.** `SignalKey` is a branded string, made by `pointSignalKey(analysisId, pointId)`, `publishedSignalKey(analysisId, publicationNumber, commentKey)` and `postedSignalKey(analysisId, at, { hunkId, side, line })`, in `src/domain/review/signal-key.ts`. Comment now has no number, so the time it was posted at tells two comments on a line apart.
- **Two small files the dependency rules forced:** `point-kind.ts` holds `PointKind` (still exported from `point.ts` and the index), and `signal-key.ts` the key functions, because `preference.ts` may import neither `point.ts`, `analysis.ts` nor `publication.ts`: they import it, and a type-only cycle fails `pnpm deps` too.
- **`PointsInput.guidance` is optional,** so the callers that build one by hand needn't change. Without it, or with null, no point has a mark.
- **Ties in creation order.** `listPreferences` and `listProposals` answer in the order made, and ones made at the same instant in the order first saved; `preferencesFor` keeps that. So a suggestion's proposals list in the order the model wrote them.
- **`getPreferences` lists the repositories of the 50 most recently updated analyses** (`store.listRecent(50)`), not of the 50 most recently analyzed PRs: the base commit comes from the analysis, and one read gives both.
- **A risk's mark is kept only on a contract hunk,** as its lines and checking test are. On a logic hunk it's set to null without a log line.
- **`Analysis.guidance` after a run with nothing to give is `{ preferences: [], guidelines: [] }`,** not null. Null means no run.

### What the use cases do beyond the Contract

- **A draft that's already said is left out:** one whose kind and text, whatever the case and spacing, match a preference or a pending or rejected proposal. That's what keeps a rejected proposal from coming back whatever the model answers. An accepted proposal doesn't count, so a preference the reviewer deleted can be proposed again.
- **A draft's `"repo"` scope when suggesting from signals:** the one repository every signal sent is from, or else the one every line of its evidence names as `owner/repo`; otherwise everywhere. So stage 56's prompt should end each evidence line with the PR it's from, as in "Dismissed: Missing JSDoc on `parseConfig`, acme/api #12".
- **One suggestion at a time, and one import per repository:** a second request while one runs joins it and gets the same answer.
- **Importing picks the model before it reads the host,** so `model-unavailable` comes without a request to the host. No history adapter for the host is still the first check.
- **A decision's state is a signal too,** with `pointKind: "decision"`. A reply to a thread is none.
- **The run reads only the guideline paths switched on.** Its warnings are "Couldn't read the repository's guideline files, so the AI review ran without them: …" and "CLAUDE.md is 40 KB, over the 32 KB a guideline file can be, so the AI review ran without it", each once however often the run is tried again.
- **Error messages the page may show as they are:** the cap, "50 preferences are already enabled for every repository: switch one off or delete it first" (or "for acme/api"); no signals, "Nothing to suggest from yet: megareviewer records the points you dismiss and raise and the comments you post"; no history adapter, "megareviewer can't read past reviews from GitHub"; a decided proposal, "The proposal is already accepted".

### The routes, as built

The eight of the Contract, named `getPreferences`, `addPreference`, `updatePreference`, `deletePreference`, `suggestPreferences`, `importPreferences`, `decideProposal` and `setGuidelineSwitch` in `routes`, with request and response schemas exported from `contracts/`: `PreferencesView`, `RepositoryPreferences`, `AddPreferenceRequest`, `UpdatePreferenceRequest`, `PreferenceDeleted`, `SuggestPreferencesRequest`, `SuggestedPreferences`, `ImportPreferencesRequest`, `ImportedPreferences`, `DecideProposalRequest`, `ProposalDecided`, `GuidelineSwitchRequest`, `GuidelineSwitched`.

- `POST /api/preferences/suggestions` takes no body or `{ optionId? }`, as `POST /api/analyses/:id/model` does.
- `PUT /api/preferences/guidelines` refuses a path outside `GUIDELINE_PATHS` as a `bad-request`. It's registered before `PUT /api/preferences/:preferenceId`, which would otherwise take "guidelines" for an ID.
- A `text` in a request is parsed with `PreferenceText`, so an empty one or one over 300 characters is a `bad-request` before the use case.

### For stage 56

- **The answer format sent doesn't ask for `guidance` yet.** `src/adapters/model/shared/output-schema.ts` builds `PASS_ANSWER_FORMAT` from `SentAnswer`, the passes' union with `guidance` left out of a finding and a risk, so the format, the fingerprints and the prompt versions are what they were. `PassAnswer`, which parses, takes `guidance` when it's there and null when it isn't. Point `PASS_ANSWER_FORMAT` at `PassAnswer`, delete `SentAnswer`, and bump the versions.
- `renderInput` doesn't read `input.guidance` yet.
- The real catalog's `suggester` is `() => null` in `src/cli/model-access.ts`, with a test, "has no suggester on any option yet", to replace. Until then suggesting and importing answer `model-unavailable`: "Sonnet 5.5 through Claude Code can't run: it can't run".
- `FakeAnalysisModel`'s derived findings and risks have `guidance: null`; a test scripts marks with `model.script("findings", ok([...]))`. `FakePreferenceSuggester({ drafts })` answers its drafts on every call, after any scripted answers, and keeps its inputs in `calls`. `FakeModelCatalog({ suggester })` serves it for every available option; `suggester: null` is a provider that can't make the call.
- `src/cli/dev/model-recording.ts` parses a recorded answer with `FindingDraft` and `ModelRisk`, so a recording without `guidance` still replays.

### For stage 57

- `describeReviewHistoryContract(name, () => ({ history, repo, unreviewedRepo }))`, from `src/application/testing/`. `repo` needs the user's comments on the code of at least two pull requests they reviewed; the suite asks once for 30 pull requests and once for 1, where it expects `pullRequests` to be 1 and comments of one pull request at most, so the fixtures need both exchanges. `unreviewedRepo` answers `{ comments: [], pullRequests: 0 }`.
- `compose.ts` passes `history: {}`. `src/cli/compose.test.ts` has a test to replace, "can't read past reviews from a host yet, which importing says".
- `FakeReviewHistory({ host, comments })` is the fake; `failWith(error)` fails its next read.

### For stage 58

- **Edits made in `web/` so it compiles,** yours to replace: the eight calls on the client in `web/src/api/client.ts`, named as the routes; handlers in `web/dev/mock-routes.ts`, where `getPreferences` answers an empty view and the other seven a `bad-request` ("The mock API keeps no preferences"); and `guidance: null` on the risk and finding literals of `web/dev/fixtures/` and four tests, with `guidance: null` on the fixture analysis.
- **`pnpm dev:fake`** starts with no preferences. `createFakeApp` answers `FakeApp.preferences`, the in-memory store, for a test to seed. The fake model proposes `fakeProposalDrafts`, two drafts, for a suggestion and for an import alike, so whichever runs second gets no proposals: they're already waiting. GitHub's history is `fakePastComments`, three comments on two pull requests of `acme/shop`; Bitbucket has none, so importing there is the `bad-request`. Suggesting needs a signal first: dismiss or raise a point, or publish a line comment.
- **small-feature's repository has no guideline files,** so its section has `guidelineFiles: []`. The fake host serves a fixture's `baseFiles` at its base commit, so a variant PR's `REVIEW.md` goes in its `baseFiles`.
- **The variant PR's marks.** A run numbers the enabled preferences `p1`, `p2`, …, everywhere's first, then the repository's, each in the order made, and the guideline files `g1`, … in `GUIDELINE_PATHS` order. A model wrapped as `withCheckingTests` wraps the risk pass can answer `guidance: { ref: "p1", effect: "raised" }` on a finding; the server keeps it only if the analysis's guidance has that ref with that effect, so the preferences have to be saved before the run.
- **On the page today** a point with `guidance.effect === "left-out"` shows as any other point, and `Point.guidance` is `{ effect, label, preferenceId }`, absent without a mark. `AnalysisView.analysis.guidance` has what the run used: the usage line's "with 6 preferences and REVIEW.md" is `guidance.preferences.length` and `guidance.guidelines[].path`.
- "Don't flag things like this" is `POST /api/preferences` with `source: "learned"`, then the point's `dismissed` state as today.

### For stage 59

- `evals/harness.ts` builds its deps with `preferences: new InMemoryPreferenceStore()` and `history: {}`. To give a case guidance, save its preferences into that store before `runModel`, and put its guideline files in the fixture's `baseFiles`: the run reads `REVIEW.md` at the PR's base commit through the fake host.
- `evals/claude-live-check.ts` builds an input by hand, now with `guidance: NO_GUIDANCE`.

### Other edits outside this stage's paths

Each is what the new fields needed to compile or to keep a test true: `guidance: null` on the proof risk in `scripts/measure-pr.ts` and on the risks in `src/cli/dev/receipts-tested.ts`; the expectation of `src/cli/dev/model-recording.test.ts`, which now compares with the parsed answer; `chooseModel` in `src/application/use-cases/analyses.ts` became `chooseOption(catalog, optionId, runner)`, shared with the suggester, and `hostFor` and `hostName` moved to `src/application/use-cases/hosts.ts`, since `guidance.ts` importing them from `analyses.ts` was a cycle.

### Verified

- `pnpm check`: typecheck, lint, dependency rules, contrast and every test, with coverage over the thresholds.
- `pnpm build`, then the `chromium` end-to-end project, the review and main-page specs on the fake server: 43 passed. The design-system project wasn't run: the page didn't change.
- On `pnpm dev:fake`, by hand over HTTP: a preference added, a model run that kept it as its guidance, a point dismissed, two proposals suggested from that signal, an import that read 3 comments of 2 pull requests, a guideline switch, and Remove AI review clearing the guidance.
- Not verified: a real model. No transport reads the guidance or makes the suggestion call before stage 56, and no host is asked for past comments before stage 57.
