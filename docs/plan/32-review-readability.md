# Stage 32: Review readability and flow grouping

**Status:** Done (on main, no PR)
**Depends on:** 31
**Owns:** Review layout and navigation in `web/src/pages/review/`, cards in `web/src/diff/`, flow grouping and risk rules in `src/domain/review/`, related regression tests and measurement tooling

## Goal

Make the guided review easier to read, especially in a narrow browser, and prevent the first flow from absorbing most of a pull request. Reduce navigation clutter without hiding changed code.

## Observed baseline

Inspected the running review `a_a6f25d6286c4ea1b` for `markdorofeev/delphi-code#2` on 2026-11-08:

- The review contains 48 hunks: 5 contract, 43 logic and no mechanical changes, arranged into 8 steps.
- GET account connections includes much of the backend and tests. PUT and DELETE have long lists of code already assigned to earlier steps.
- Small changes have large headers, caller links, part numbers and neighboring-part links.
- At the narrow in-app browser width, header controls extend offscreen and the Overview requires horizontal navigation. `review.css` explicitly sets a 1000px minimum width below 1024px.
- The intent preview exposes Markdown markers such as `**Bitbucket and GitHub accounts**`.
- Credential-handling methods and token-changing routes are classified as logic, while the fake keychain and credentials guide receive contract classification from path rules.
- The Overview connects frontend requests to backend routes, and symbol search successfully focuses the corresponding file.
- This analysis has no unchanged callers because it did not use a matching checkout. It appears to be a non-AI analysis; verify its recorded stages before using it as a measurement baseline.

## Read first

- MISSION.md, DESIGN.md, ARCHITECTURE.md and ENGINEERING.md
- Stages 25–31, especially their measurements and open issues
- `web/src/pages/review/review.css`, `ReviewHeader.tsx`, `IntentLine.tsx`, `MapLayout.tsx`, `RiskRail.tsx` and `Overview.tsx`
- `web/src/diff/HunkCard.tsx`
- `src/domain/review/code-tour.ts`, `join-parts.ts` and `risk-rules.ts`
- `scripts/measure-pr.ts`

## Implementation order

### 1. Responsive layout and readable intent

- Remove the forced page minimum width below 1024px.
- Wrap header controls while keeping Publish and review progress accessible.
- Put the Map rail behind a toggle on narrow screens.
- Keep horizontal scrolling local to code blocks and the Overview canvas, rather than the whole page.
- Convert Markdown in the intent preview to readable plain text. Preserve the full description in Details and continue treating PR content as untrusted text.

These changes must work with existing cached analyses and require no reanalysis.

### 2. Less navigation clutter

- Keep file, definition, risk and Reviewed in the card header.
- Replace repeated part counts, lists of other steps and neighboring-part rows with one expandable Related parts control.
- Summarize Passes through links by destination step, with individual links available on expansion.
- Preserve inline call previews and access to unchanged callers.
- Keep all flow headings available in the rail; expand detailed entries for the active flow. Ensure search and direct navigation can reveal their target.
- Preserve keyboard navigation, focus behavior, comment anchors and review progress.

This is presentation work: changed code stays visible and mechanical changes remain collapsed only with proof.

### 3. Flow grouping and risk detection

Measure before changing the algorithm:

- Identify which call-graph edges cause GET to absorb most of the PR.
- Distinguish incorrect links from genuinely shared implementation.
- Record the largest flow, cross-step references and complete part coverage.

Then:

- Fix incorrect links before changing grouping. If fixes require changes outside this stage's owned paths, follow the plan overview's ownership rules.
- Give genuinely shared implementation a coherent section referenced by the flows that use it, rather than assigning all shared code to the first flow that visits it.
- Preserve caller-before-callee order within flows, test associations and exactly-once coverage of every part. Do not impose arbitrary size caps or split unrelated code merely to meet a number.
- Document the shared-section representation and ordering in DESIGN.md and ARCHITECTURE.md before implementing it. Make any required shared-contract change separately and record it in stage 02's change log.
- Add targeted risk rules for credential storage, authorization and token-changing endpoints, with concrete reasons and counterexamples in tests.
- Do not blanket-downgrade tests or guide files to reduce warnings. Preserve the rule that deterministic contract classifications cannot be lowered by the model.
- Bump the pipeline version when analysis behavior changes so cached results regenerate.

## Validation

- Compare this PR before and after using the same source diff and files: largest flow, cross-step references, navigation clutter and complete part coverage.
- Inspect Map and Overview at 720px, 1024px and desktop widths. Header controls must remain reachable without page-level horizontal scrolling.
- Add meaningful regression tests for the observed layout and Markdown bugs, flow grouping, risk rules, navigation and review progress.
- Verify that every part appears exactly once in the main tour, shared code is reachable from every relevant flow, and mechanical proofs retain their behavior.
- Run `pnpm check`, `pnpm build` and relevant end-to-end tests.
- If model prompts or schemas change, follow the project's eval workflow; do not treat the existing unfinished tour evals as completed by this work.

## Out of scope

- Changing credentials or Bitbucket permissions. The observed missing `read:user:bitbucket` scope is a separate setup issue.
- Automatically locating or changing the user's checkout. Missing checkout context should remain clearly explained.
- Publishing a review or changing reviewer verdicts during validation.
- Adding code comments unless explicitly requested.

## Definition of done

- [x] Responsive layout and intent preview fixed.
- [x] Part navigation and shared-code links are compact and accessible.
- [x] Baseline and after measurements recorded.
- [x] Oversized flows addressed with evidence, without losing coverage or imposing arbitrary caps.
- [x] Credential-related risk rules improved with regression cases.
- [x] Analysis changes invalidate old caches.
- [x] Design, architecture and any contract changes documented.
- [x] Required checks and browser verification pass.

## Measurements

`pnpm measure a_a6f25d6286c4ea1b --checkout ~/Projects/work/delphi-code` on the same cached diff and files, before (`dede58f`, pipeline 11) and after (pipeline 12). `measure-pr.ts` now prints the largest flow, cross-step references, destination summaries and part coverage.

| | Before | After |
|---|---|---|
| Steps | 8 | 10 (2 shared sections) |
| Largest step | GET, 37 of 73 parts | Shared connection code, 23 of 79; GET 21 |
| Cross-step references (`via`) | 34 | 50 |
| Passes-through rows on the page | 34 links | 9 summaries, one per destination step, links behind them |
| Missing, duplicate or unexpected parts | 0, 0, 0 | 0, 0, 0 |
| Contract hunks | 5 | 15 |

**Why GET absorbed the PR.** The call edges were listed with a scratch script and the ones that pull PUT and DELETE into GET's code were read in the PR's head: none is wrong. `connect_account` and `forget_saved_token` both return `_refreshed_connection(domain)`, which calls `self.account_connections()`, so PUT and DELETE run the whole connection listing (`_account_connection`, `token_form`, `has_saved_token`, `_saved_token`, the keychain's `saved_secret` and `_run`) that GET reads first. That's genuinely shared code, so the fix is the shared section, not a link fix. The rest of GET's size is hosts.py code no flow runs (the `GitHub` and `Bitbucket` classes, `clone_credentials`), which joins the flow with most of its file, and the tests of those, which is where they belong.

The shared section reads remote_repositories.py, hosts.py, hosting_services.py and keychain.py in call order with its tests, and says "used by steps 3, 4 and 5". The second section is `AccountConnectionResponse`, one type PUT and DELETE both return; it's a section of one part because nothing calls between it and the first.

Cross-step references grew because GET now passes through the shared code it used to own. The page summarizes them by destination step, so the reader sees 9 rows instead of 34 links.

**Risk.** The new contract hunks: the routes file (PUT and DELETE token routes, `save_account_token`), five hosts.py hunks (`save_token`, `_saved_token`, `_authorization_for` and the like), `application.py` and `remote_repositories.py` (`forget_saved_token`, `save_token`), `tests/fakes.py` and one `test_picker.py` hunk that call them. The fake keychain and the credentials guide stay contract by path. The first draft of the rule listed delphi-code's own function names; it matches by name shape instead, and the counterexamples (`save_token_count`, `count_tokens`, `tokenize`, `setToken`, a GET route, a client request) are in `risk-rules.test.ts`.

**Layout.** Checked live on delphi-code #2 at 720px, 1024px and 1440px: the page never scrolls sideways, Publish and the progress stay on screen, the rail is behind Show Map at 1024px and below with one step expanded, and the overview scrolls inside its canvas (1208px of content in a 670px box at 720px). The intent line reads "The setup page gets a Bitbucket and GitHub accounts section:" without Markdown markers. The e2e test `review stays within the viewport` covers the same at the three widths on the fake host.

## Notes for later stages

- **The analysis checked live was not with `--ai`.** Prompts and schemas didn't change (a shared section is an ordinary flow step), so no eval run was needed; the tour evals stay open as stage 31 left them.
- **Shared sections come before every flow,** so the reader meets the connection code before the GET route that leads to it. The step says which steps use it. Placing it after its first consumer would need `via` to point forward, which the tour's validation forbids.
- **A section of one small type** (`AccountConnectionResponse`) is honest but adds a step. Merging sections that the same flows use, when nothing calls between them, is the next thing to try if it proves noisy.
- **Credential rules raise tests that call credential code** (`fakes.py`, one `test_picker.py` hunk). The stage says not to downgrade tests to reduce warnings, so they stay.
