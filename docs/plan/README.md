# Implementation plan: first slice

This plan builds the first slice described in [ARCHITECTURE.md](../../ARCHITECTURE.md#first-slice). It is split into stages, each in its own document, so different agents can pick them up in parallel.

The product docs stay the source of truth for *what* and *why*: [MISSION.md](../../MISSION.md), [DESIGN.md](../../DESIGN.md), [ARCHITECTURE.md](../../ARCHITECTURE.md), [ENGINEERING.md](../../ENGINEERING.md). Stage docs say *how*.

## Stages

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 01 | [Scaffolding and tooling](01-scaffolding.md) | — | Root configs, CI, folder skeleton, `src/domain/shared/` |
| 02 | [Domain model, ports and contracts](02-domain-and-contracts.md) | 01 | `src/domain/review/`, `src/domain/diff/types.ts`, `src/domain/shared/hash.ts`, `src/application/ports/`, `src/application/testing/`, `contracts/` |
| 03 | [Diff parsing and mechanical proofs](03-diff-parsing-and-proofs.md) | 02 | `src/domain/diff/` (except S04's files) |
| 04 | [tree-sitter: formatting proofs and call-graph hints](04-tree-sitter.md) | 02 | `src/adapters/treesitter/`, `src/domain/diff/formatting.ts`, `src/domain/diff/call-graph.ts` |
| 05 | [GitHub adapter](05-github-adapter.md) | 02 | `src/adapters/github/` |
| 06 | [Bitbucket Cloud adapter](06-bitbucket-adapter.md) | 02 | `src/adapters/bitbucket/` |
| 07 | [Jira adapter](07-jira-adapter.md) | 02 | `src/adapters/jira/` |
| 08 | [Claude adapter: model passes](08-claude-adapter.md) | 02 | `src/adapters/claude/` |
| 09 | [SQLite store](09-sqlite-store.md) | 02 | `src/adapters/sqlite/` |
| 10 | [Use cases and pipeline](10-use-cases.md) | 02, 03 | `src/application/use-cases/`, `src/application/events/`, `src/domain/review/publication.ts` |
| 11 | [HTTP API](11-http-api.md) | 10 | `src/adapters/http/` |
| 12 | [CLI, composition root and packaging](12-cli-and-packaging.md) | 04–09, 11 | `src/cli/`, `scripts/`, `package.json` bin/files/build |
| 13 | [Web shell, API client and PR picker](13-web-shell.md) | 02 | `web/` (except S14 and S15 folders) |
| 14 | [Diff view component](14-diff-view.md) | 02 | `web/src/diff/` |
| 15 | [Review page and publishing](15-review-page.md) | 13, 14 | `web/src/pages/review/` |
| 16 | [Evals](16-evals.md) | 08, 10 | `evals/` |
| 17 | [End-to-end tests, dogfooding and release](17-e2e-and-release.md) | 12, 15, 16 | `e2e/`, `README.md`, release config |

```mermaid
flowchart LR
  S01[01 Scaffolding] --> S02[02 Domain & contracts]
  S02 --> S03[03 Diff & proofs]
  S02 --> S04[04 tree-sitter]
  S02 --> S05[05 GitHub]
  S02 --> S06[06 Bitbucket]
  S02 --> S07[07 Jira]
  S02 --> S08[08 Claude]
  S02 --> S09[09 SQLite]
  S02 --> S13[13 Web shell]
  S02 --> S14[14 Diff view]
  S03 --> S10[10 Use cases]
  S10 --> S11[11 HTTP API]
  S08 --> S16[16 Evals]
  S10 --> S16
  S13 --> S15[15 Review page]
  S14 --> S15
  S04 --> S12[12 CLI & packaging]
  S05 --> S12
  S06 --> S12
  S07 --> S12
  S08 --> S12
  S09 --> S12
  S11 --> S12
  S12 --> S17[17 E2E & release]
  S15 --> S17
  S16 --> S17
```

### Waves

| Wave | Stages | Parallel agents |
|---|---|---|
| 1 | 01 | 1 |
| 2 | 02 | 1 |
| 3 | 03, 04, 05, 06, 07, 08, 09, 13, 14 | up to 9 |
| 4 | 10 (needs 03), 15 (needs 13, 14) | 2 |
| 5 | 11, 16 | 2 |
| 6 | 12 | 1 |
| 7 | 17 | 1 |

Stage 02 is the bottleneck on purpose: it fixes every type, port and API contract so wave 3 can run without agents waiting on each other. Keep it small and finish it fast.

## Second slice: review without the model

The first slice needs the model for almost everything on the review page: intent, risk classes, decisions and the tour. The second slice makes the model optional. With it off, the review page is built from deterministic code only, so the page is good enough to review with before any model call, and the model passes later improve what the page already shows instead of producing it.

The layout stays the guided tour. Without the model:

- **Risk** comes from rules that can only mark a hunk *contract*, never hide one.
- **The tour** follows the call graph from the entry point, with each test next to the code it tests.
- **Visual weight follows risk.** Contract hunks stand out with their reason shown inline, logic hunks look as they do now, and mechanical hunks shrink to one dimmed line with their proof.

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 18 | [Rule-based risk](18-rule-based-risk.md) | — | `src/domain/review/risk-rules.ts` |
| 19 | [Tour from the call graph](19-code-tour.md) | 18 | `src/domain/review/code-tour.ts` |
| 20 | [Model passes optional](20-model-optional.md) | 18, 19 | `src/application/use-cases/run-pipeline.ts`, `src/cli/` |
| 21 | [Risk-weighted review page](21-risk-weighted-ui.md) | 18 | `web/src/diff/`, `web/src/pages/review/TourNav.tsx`, `MainArea.tsx` |
| 22 | [Navigation and review progress](22-navigation.md) | 19, 21 | `web/src/pages/review/` except stage 21's files |
| 23 | [Comments on hunks](23-hunk-comments.md) | 20 | `src/domain/review/publication.ts`, `web/src/pages/review/PublishDialog.tsx` |

Once stage 18 is done, stages 19 and 21 run in parallel; 21 works on the dev fixtures until 20 lands. Each of 18, 19 and 20 changes a stage 02 contract; that change goes in its own PR as described below.

## Third slice: code-first review page

The review page still opens on an intent panel and two sidebars, and shows one tour step at a time. This slice opens it on the code and moves the explaining into navigation: a risk map beside one scroll of code, or a call tree, chosen by a toggle. Its design is on the [Review page redesign](https://claude.ai/artifact/YQfPAHQvsmm59w47wNyceE) canvas.

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 24 | [Code-first review page](24-code-first-review.md) | 22, 23 | `web/src/pages/review/`, `web/src/diff/`, `src/domain/diff/call-graph.ts` |

It's one stage because both layouts share the hunk cards, decisions and shortcuts it moves. The `CallGraphHint` change goes in its own PR first.

## Fourth slice: navigation by flows

Without the model, the tour's steps are whatever the call graph happens to connect, so their titles say nothing and one step can hold most of the PR. This slice makes each step a flow: an entry point (a route, a page, a command) and the changed code it runs. The stages after it fix what reviewers still struggle with: too many chips, a call tree nobody uses, and hunks too coarse to place in one flow.

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 25 | [Tour by flows](25-flows.md) | 24 | `src/domain/review/code-tour.ts`, `entry-points.ts`, `src/domain/diff/call-graph.ts`, step headings in `web/src/pages/review/` |
| 26 | [Fewer chips on the map](26-chip-rules.md) | 25 | `scripts/measure-pr.ts`, chips, mentions and callers in `web/src/pages/review/` and `web/src/diff/HunkCard.tsx` |
| 27 | [Overview of the changed files](27-overview.md) | 25, 26 | `src/domain/diff/file-links.ts`, the overview replacing the call tree in `web/src/pages/review/` |
| 28 | [Hunks split by definition](28-hunk-parts.md) | 26, 27 | `src/domain/diff/parts.ts`, `call-graph.ts`, `src/domain/review/code-tour.ts`, `validation.ts`, partial cards and reviewed state in `web/` |
| 29 | [Links from requests to routes](29-request-links.md) | 27, 28 | `src/domain/diff/requests.ts`, `call-graph.ts`, `code-tour.ts`, request chips and edges |
| 30 | [Unchanged callers from a local checkout](30-unchanged-callers.md) | 27, 28 | `LocalCheckout` port, `src/adapters/git/`, callers on cards and in the overview |
| 31 | [Flows as the model's tour](31-model-tour-from-flows.md) | 28 | The tour pass in `src/adapters/claude/`, `runTour`, `evals/` tour scoring |

The order is by value to a reviewer:

1. **26, chips,** because the map is the default layout and every reviewer reads it on every PR: on delphi-code #2, 29 of its 54 chips repeat a call shown earlier in the same flow. It's also the smallest stage, with no contract change.
2. **27, overview,** because the second layout is unusable today (13 of the call tree's 42 rows are "above" repeats), and nothing on the page shows how the changed files connect.
3. **28, parts,** because it fixes the tour's worst step on delphi-code #2 (three routes in one flow holding 32 of 48 hunks). It's the largest and riskiest change, so it waits until 26 keeps the extra chips in check.
4. **29, requests to routes,** because it joins a full-stack PR's two halves, which 27 shows as unconnected. It needs 28, so a request links to one route instead of a hunk of three.
5. **30, unchanged callers,** because it's the only stage that shows code outside the diff, where regressions live. It comes after 29 because it needs a local checkout, which helps only reviewers who run megareviewer in one.
6. **31, the model's tour from flows,** last, because it helps only `--ai` users, and costs eval runs.

After 28, stage 31 can run beside 29 or 30. Stages 29 and 30 both change `call-graph.ts`, so one waits for the other. `PIPELINE_VERSION` numbers in the stage docs assume this order; a stage run out of order takes the next free number.

Each stage measures itself on [delphi-code #2](https://github.com/markdorofeev/delphi-code/pull/2) with `pnpm measure`, which stage 26 adds: it runs today's prep and tour on the diff and files cached in `~/.megareviewer/db.sqlite`.

## Fifth slice: review readability

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 32 | [Review readability and flow grouping](32-review-readability.md) | 31 | Responsive review layout, compact card navigation, flow grouping and risk-rule improvements |
| 33 | [One card per file in a step](33-file-cards.md) | 32 | Map cards in `web/src/pages/review/` and `web/src/diff/HunkCard.tsx` |
| 34 | [Grouping the map's files](34-map-grouping.md) | 33 | Grouping and the contract index in `web/src/pages/review/` |
| 36 | [A directory tree beside the code](36-tree-rail.md) | 35 | The tree rail and the Overview's directory boxes in `web/src/pages/review/` |
| 37 | [No reasons on a part's divider](37-off-screen-reasons.md) | 36 | The contract divider in `web/src/diff/HunkCard.tsx` and `web/src/pages/review/` |
| 38 | [Contract from path rules only](38-path-rules-only.md) | 37 | `src/domain/review/risk-rules.ts`, `PIPELINE_VERSION` |
| 39 | [A miniature of the Overview in the rail](39-mini-overview-rail.md) | 36 | The rail's switch and its Overview form, the layout shared with the Overview, in `web/src/pages/review/` |

Implement the responsive layout first, navigation simplification second, and measured analysis changes last. The first two changes work with existing cached analyses; analysis changes require a pipeline version bump.

## Sixth slice: the conversation on the PR

The page shows only the reviewer's own drafts. This slice brings the PR's existing review threads onto the code, so the reviewer can reply, resolve and apply suggestions without going to the host.

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 40 | [Review threads on the code](40-review-threads.md) | 23, 36 | `ReviewThreads` port and adapters, `src/domain/review/thread.ts`, thread routes, `web/src/review/thread/` |

## Seventh slice: the model on the reviewer's Claude plan

`--ai` needs an API key and bills every review per token. This slice runs the passes through the reviewer's own Claude Code instead, so they come out of the plan the reviewer already has.

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 41 | [The model through Claude Code, by default](41-claude-code-model.md) | 20, 31 | The Claude Code transport in `src/adapters/claude/`, model selection in `src/cli/`, the evals' model option |

The `ModelUsage` change goes in its own PR first.

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 42 | [Claude from a button on the review](42-model-from-the-page.md) | 41 | `--ai` removed; the model run on an open analysis, its route and button |
| 43 | [Triage and findings from Claude, landed in the code](43-triage-and-findings.md) | 42 | The findings pass, points with Raise and Dismiss, the wait and the landing, the replayed model for testing without spend |
| 44 | [A bar that stays, with a stepper through Claude's points](44-review-bar.md) | 43 | The header, the sticky bar, the point stepper and the Publish button in `web/src/pages/review/` |
| 45 | [Claude's points on the lines, each kind its own weight](45-points-on-the-lines.md) | 44 | Findings as draft comments under their lines, risks as bands, decisions as footnotes; the findings and decisions prompts |
| 46 | [The PR's state, its reviewers and CI in the header](46-pr-status.md) | 44 | The `PullRequestStatus` port and adapters, its route, the header's badges, CI summary and reviewers |

## Eighth slice: measuring the prompts

The risk and decisions prompts were changed for noise that showed on delphi-code #2 and that the evals can't see: risks on hunks no label covers, risks on the wrong lines, and decisions that repeat the description. This slice makes the evals see it, adds the PR it showed on, and moves the judge onto the whole PR and the reviewer's Claude plan. Repeats and the first baseline come after it.

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 47 | [Evals that see noise and placement](47-eval-noise-metrics.md) | 45 | `evals/` except stage 48's case |
| 48 | [delphi-code #2 as an eval case](48-delphi-eval-case.md) | 47 | `evals/cases/delphi-account-connections/` |
| 49 | [A judge that reads the whole PR, on the Claude plan](49-judge-whole-pr-on-plan.md) | 47 | The judge and runner in `evals/`, the structured-call export in `src/adapters/claude/` |

## Ninth slice: a risk that reads as part of the page

On delphi-code #2 a risk's magenta band looked like another product's, was louder than a finding, and its bar down the lines went unseen.

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 50 | [A risk as a note under its lines, in amber](50-risk-note.md) | 45 | The risk's note and the points' marks on line numbers in `web/src/pages/review/` and `web/src/review/diff/`, the risk tokens |

## Tenth slice: the reviewer's choice of model

Every review runs on Haiku 5.5 through Claude. This slice lets the reviewer choose the model on the page, among the ones the commands on their machine can run, with the rest shown disabled and why.

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 51 | [A choice of model, among what's installed](51-model-choice.md) | 42, 45 | `src/adapters/claude/` moved to `src/adapters/model/`, the `ModelCatalog` port, the model routes, the split button on Request AI review |
| 52 | [OpenAI's models through Codex](52-codex-models.md) | 51 | `src/adapters/model/codex/`, Codex's provider in `src/cli/` |
| 53 | [Models through opencode](53-opencode-models.md) | 51, 52 | `src/adapters/model/opencode/`, opencode's provider in `src/cli/` |

Stage 51 ships with Claude's models only, so the list, its detection and the button are settled before a second provider depends on them. Stages 52 and 53 each start with a check that can stop them: whether Codex's sandbox blocks the network, and whether opencode can be run without tools at all. Stage 53 waits for 52 because it reuses its lockdown rule and its nullable cost.

## Eleventh slice: the page a review starts from

The main page is a URL field, a setup strip and two lists. This slice rebuilds it after the `hunk-home-v3` design: the setup strip becomes a Connections button in the header, and a calendar shows the reviews and comments the reviewer posted.

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 54 | [The main page: lists, connections in the header, review activity](54-main-page.md) | 13, 23, 40, 46 | `web/src/pages/picker/`, the header's Connections button, `src/domain/review/activity.ts`, the `thread_posts` table, the activity route |

The activity types, the store's methods and the route go in their own PR first.

## Twelfth slice: what the reviewer values

An AI review says the same things to every reviewer. This slice collects what a reviewer values, on their machine, and uses it in Request AI review: rules they write, rules proposed from what they dismiss, raise and comment, the repository's guideline files, and their past comments on the host. Nothing learned is used until the reviewer accepts it.

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 55 | [Preferences: the domain, the store, the API and the run's guidance](55-preferences-core.md) | 43, 45, 51, 54 | `src/domain/review/preference.ts`, the `PreferenceStore`, `PreferenceSuggester` and `ReviewHistory` ports, the preference tables, use cases and routes, a run's guidance |
| 56 | [The model reads the reviewer's guidance, and suggests preferences](56-guidance-in-the-passes.md) | 55 | `src/adapters/model/`, the catalog's `suggester` |
| 57 | [The reviewer's past comments, from GitHub and Bitbucket](57-review-history.md) | 55 | `ReviewHistory` in `src/adapters/github/` and `src/adapters/bitbucket/` |
| 58 | [The preferences page, and guidance on the review page](58-preferences-page.md) | 55 | `web/src/pages/preferences/`, guidance on a point in `web/src/pages/review/`, `e2e/preferences.spec.ts` |
| 59 | [Evals for guidance](59-preference-evals.md) | 55, 56 | `evals/` |

Stage 55 is the bottleneck on purpose, as stage 02 was: it fixes the types, ports, routes and fakes, so 56, 57 and 58 run side by side, with 59's cases and scoring beside them. Only stage 55 writes DESIGN.md, ARCHITECTURE.md and ENGINEERING.md; the others record what they decide in their own doc's notes, and it's folded in when the slice is merged. The evals run last, once 56's prompts are in.

## Thirteenth slice: the file tree after its v4 design

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 60 | [The file tree after the v4 design](60-file-tree-v4.md) | 36, 45, 50 | `web/src/review/tree/`, the vendored IDEA icons, the tree's tokens and contrast pairs |

## Fourteenth slice: the review header after its final design

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 61 | [The review header after its final design](61-review-header.md) | 15, 41, 47 | The review page's header and bar, Approve, the AI tint's tokens and contrast pairs |

## Fifteenth slice: code and file tree typography

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 62 | [Code and file tree typography](62-code-and-tree-type.md) | 14, 60, 61 | The code and tree fonts, the type scale, the syntax palette and its roles, the light diff tints and their contrast pairs |

## Sixteenth slice: a check instead of a fix

A finding the author fixes in one place comes back in another. This slice has megareviewer say, on a finding or a risk a check could catch, which check: a rule of the repository's own tools, or one somebody would write.

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 63 | [A check instead of a fix](63-check-instead-of-fix.md) | 45, 55, 56, 58, 59 | `src/domain/review/guardrail.ts`, the `GuardrailAdvisor` port, a model run's guardrail call, the guardrail's line on a finding, a risk and a draft made from one, the guardrail call's evals |

It's one stage for one agent: the call, the server's check and the line share the guardrail's types and the check configs.

## Seventeenth slice: a tour of the PR

Between the brief's three lines and the files, nothing says what happens and in which order. This slice adds a tour to the second layout, behind a switch in the Display menu: a few steps the model writes, each a sentence and the lines that decide, with a count of what the tour didn't show.

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 64 | [A tour of the PR, behind a switch](64-tour.md) | 27, 45, 50, 56, 61 | The `steps` pass and its checks, the Understand layout, the Display menu's switches, the steps' eval scores |

## Eighteenth slice: the repository beside the PR

Code outside the PR that calls what it changes shows only when megareviewer is started inside a clone that has the PR's head commit. This slice has megareviewer find a clone on the machine, and download the commit into a copy of its own when there's none.

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 65 | [A clone found on this machine](65-clone-on-this-machine.md) | 30 | The `LocalCheckouts` port, the home folder search in `src/adapters/git/`, the `known_checkouts` table, `--no-search` |
| 66 | [megareviewer's own copy of the repository](66-own-copy-of-the-repository.md) | 65 | The `RepositoryCopies` port, the download in `src/adapters/git/`, callers added to a complete analysis, `--no-download` |

One after the other: both change the checkout's port, the git adapter and how an analysis looks a checkout up. Stage 66 starts with a check of each host's git access that can stop it.

## Nineteenth slice: the repository's harness

A repository's rules for an AI review are rarely one file. `CLAUDE.md` or `AGENTS.md` is an index that points at the documents with the rules in them: megareviewer's own `CLAUDE.md` is 310 bytes and imports 216 KB. A run reads only the five root files today, each whole or not at all over 32 KB, so switching `CLAUDE.md` on gives the model "Follow ENGINEERING.md" and nothing else. This slice finds the files a root file links, loads them when a PR opens, gives a run the ones the author said to always load, and lets every pass read the rest on request.

| # | Stage | Depends on | Owns |
|---|---|---|---|
| 75 | [The harness: the domain, the ports, the store and loading](75-harness-core.md) | 55, 56 | `src/domain/review/harness.ts`, the `HarnessSource` and `HarnessStore` ports, their fakes and contract suites, the harness tables, `src/application/use-cases/harness.ts`, the start of loading in `analyses.ts`, the slice's text in DESIGN.md, ARCHITECTURE.md and ENGINEERING.md |
| 76 | [The harness from GitHub and Bitbucket](76-harness-sources.md) | 75 | `HarnessSource` in `src/adapters/github/` and `src/adapters/bitbucket/`, their fixtures, their wiring in `src/cli/compose.ts` |
| 77 | [A run reads the linked files the author always loads](77-harness-in-guidance.md) | 75 | `src/application/use-cases/guidance.ts`, the guidance of `AnalysisInput`, `render-input.ts` and the prompts' text on guideline files |
| 78 | [The harness on the Preferences page](78-harness-on-the-page.md) | 75 | The guideline parts of `contracts/api.ts`, `preferences.ts` and `src/adapters/http/`, `web/src/pages/preferences/`, the Request AI review tooltip |
| 79 | [A read tool in every pass, through Claude Code](79-read-tool.md) | 77 | The read tool's contract in `src/application/ports/analysis-model.ts`, `model-passes.ts` and `src/adapters/model/shared/`, the Claude Code transport, reads in Run details, `evals/spikes/harness-read-tool/` |
| 80 | [The read tool on the Anthropic API](80-read-tool-api.md) | 79 | The API transport in `src/adapters/model/claude/` |
| 81 | [The read tool on opencode](81-read-tool-opencode.md) | 79 | `src/adapters/model/opencode/` |
| 82 | [Evals for the harness](82-harness-evals.md) | 77, 79 | `evals/` |

Stage 75 is the bottleneck, as 55 was: it fixes the types, ports and fakes, so 76, 77 and 78 run side by side. Stage 79 fixes the read tool's contract and builds it on the default transport; 80 and 81 then run side by side. Stages 75 and 79 write DESIGN.md, ARCHITECTURE.md and ENGINEERING.md; the others record what they decide in their own notes, folded in when the slice is merged.

### Decisions the stages share

- **Rules come from the base commit.** Every harness file is read at the PR's base commit, as guideline files are, so a PR can't add a link to its own rules.
- **Content is kept by blob hash.** A file that didn't change between two base commits is stored and fetched once. Keeping it by commit, as `file_contents` does, refetched every file each time the target branch moved.
- **No MCP server.** The read tool is each command's own file reader over a directory megareviewer writes, or on the API a tool megareviewer serves. An MCP server of ours was the first design: one handler on every transport, and no read tool at all for an organization whose `managed-mcp.json` forbids added servers.
- **Codex gets no read tool.** Its only reader is the shell, which the sandbox lets read the whole disk, and a denied command isn't on its stream. It runs on the files a run always loads.
- **A file of any size is usable.** The 32 KB limit becomes a budget on what's put in every pass's prompt. What doesn't fit is read on request.
- **Whether reading helps is unmeasured** until stage 82. A reviewer meets the read tool only after switching on a root file that links others, and `REVIEW.md` alone is on by default, so 79 to 81 can land before it; the release that announces the harness waits for 82's report.

The measurements behind the transport decisions are the spike's, `evals/spikes/harness-read-tool/RESULTS.md` on branch `claude/read-tool-spike-4956c1`, which stage 79 brings to `main`.

### Room for a full checkout

megareviewer may later read a repository from a clone of its own, or from the reviewer's checkout, in place of the host's API. The slice is built so that this is one more implementation and no redesign:

- **`HarnessSource` is the only way a file is found or fetched.** It lists paths with their blob hashes, reads contents and says which paths changed between two commits, and a source that can't do one of them says so. `LocalCheckout` reads at a commit, so a checkout-backed source is an adapter over it, chosen in the one function that picks a repository's source (stage 75, whose notes say what it lacks).
- **The blob hash is git's own.** A source that reads git's object store keys content the way the store already does, and the harness tables need no change.
- **A pass's directory has a root per kind of content.** Harness files go under `harness/`, and the tool's reads are recorded by the path the model used. Code at the PR's head commit would be a second root beside it, with no change to the harness's paths, its index or the record of reads (stage 79).
- **The base commit rule doesn't depend on the source.** Rules stay the base commit's whatever is added later; code context would be the head commit's and stays untrusted data.

Not built here: the checkout-backed source, a clone megareviewer keeps, and code in the read tool.

## How to pick up a stage

1. Check the stage doc's **Status** line. Only start a stage that says *Not started* and whose dependencies say *Done*.
2. Set **Status** to `In progress (branch stage/NN-slug)` in a first commit.
3. Work on branch `stage/NN-slug` from the latest `main`.
4. Read the stage doc's **Read first** list. [CLAUDE.md](../../CLAUDE.md) already loads the product docs.
5. Change only paths your stage **Owns**. The exceptions are `package.json` and `pnpm-lock.yaml` when you add a dependency (say why in the PR, per ENGINEERING.md §8). If you need a change elsewhere, see the next section.
6. Open a PR to `main`. You may split a stage into several PRs; each must pass CI.
7. When the last PR merges, set **Status** to `Done (PR links)` and fill **Notes for later stages** with anything that differs from this doc.

## Changing something you don't own

- **Contracts from stage 02** (domain types, ports, `contracts/`, fakes, contract test suites) are shared by everyone. Don't change them silently inside your stage. Open a separate small PR that changes only the contract and its fakes, describe the change and who's affected in the PR, and add a line to stage 02's **Change log**.
- **Anything else:** leave a note in your stage doc's **Notes for later stages** and, if it blocks you, stop and ask the user.
- **If a stage doc is wrong** (an API doesn't behave as described, a type doesn't fit), follow what's right and record the deviation in **Notes for later stages**. Docs describe intent; reality wins.

## Definition of done (every stage)

- `pnpm check` passes locally and in CI: typecheck, lint and format, dependency rules, tests, coverage thresholds.
- Every item in the stage's **Definition of done** is checked.
- The stage changed only paths it owns, plus contract PRs made as described above.
- New decisions that change DESIGN.md or ARCHITECTURE.md are written there in the same PR (ENGINEERING.md §10).
- The PR description states the intent, links the stage doc, and lists decisions made along the way.

## Credentials agents may not have

Some stages need real accounts to record fixtures or run live checks (GitHub, Bitbucket, Jira, Anthropic). If you don't have them:

- Build synthetic fixtures from the official API docs and mark them `synthetic` in the fixture file name.
- Leave the recorder script in place.
- Add an **Open issue** to the stage doc saying which fixtures still need recording.

Never commit tokens, and strip `Authorization` headers and personal data from recorded fixtures.
