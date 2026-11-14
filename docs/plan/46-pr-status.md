# Stage 46: The PR's state, its reviewers and CI in the header

**Status:** Done (branch `claude/badges-ci-reviewers-e45ec3`): `pnpm check` and `pnpm e2e` pass, checked live on GitHub and Bitbucket; see **Notes for later stages**
**Depends on:** 44
**Owns:** `src/domain/review/pr-status.ts`, the `PullRequestStatus` port and its fake and contract suite, `status.ts` in `src/adapters/github/` and `src/adapters/bitbucket/`, the status use case and route, `usePrStatus.ts` and the header's status items in `web/src/pages/review/`, their examples in `web/src/design-system/`

## Goal

The header says what the PR is and what it changes, but not where it stands: whether it's still open, what the other reviewers said, and whether CI passed. A reviewer goes to the host for those before deciding how hard to look, and again before publishing an approval. Stage 44 left them out because each needs a new read from both hosts and a contract change. This stage adds them, after the PR header design:

```
acme / scheduler #482 ↗                    7 threads · 2 unresolved │ ✓ CI 12/12 passed │ (LS✕)(JK✓)(+1)
Add exponential backoff to job retries  [● Open]  [✕ Changes requested]
mark wants to merge feat/retry-backoff → main · updated 40m ago · 4 files +22 −8
```

## Decisions

- **Read live, never cached, like threads.** State, reviews and CI change without a push, so they aren't part of the analysis and `PIPELINE_VERSION` doesn't change. They load when the page opens, after a publish, when the window regains focus, and every 60 seconds while a check is running and the tab is visible. No polling otherwise: Bitbucket's hourly limit is per user and shared with the picker.
- **A port of its own, `PullRequestStatus`,** with one method, `getStatus(ref, headSha)`. `GitHost` collects and publishes, `ReviewThreads` is the conversation; this is a third use case, read-only, and both adapters pass one contract suite. Methods on `GitHost` were the alternative; ARCHITECTURE.md already records why threads didn't go there.
- **CI is the analysis's head commit's, not the PR's latest.** The reviewer reads the code at that commit, so "12/12 passed" about a newer push would vouch for code they aren't looking at. When the PR has moved on, the stale banner already says so.
- **The state badge always shows,** as the design has it: Open, Draft, Merged, Closed (Declined on Bitbucket). Open in the primary color with a filled dot, Draft muted with a hollow one, Merged and Closed each with their own glyph. Showing it only when the PR isn't open was the alternative: nearly every PR reviewed here is open, as nearly every file in the tree is modified, which is why the tree shows no status for those. The header names one PR, not a list of rows, so one badge costs little, and a badge that's always there is one the reviewer learns to read, so its change to Merged is noticed.
- **The review status badge only when it says something:** Approved or Changes requested. GitHub's own `reviewDecision` is used, since it counts what branch protection counts; Bitbucket has none, so `reviewStatusOf` derives it in the domain: changes requested if any reviewer requested them, else approved if any approved, else none. "Review required" isn't shown: it's the state of every PR waiting for this reviewer.
- **Reviewers are initials, not avatars,** as threads are: an avatar is a request to the host's CDN per face. Each carries a mark of its verdict, ✓ approved, ✕ changes requested, a speech mark for commented, none while only requested, never color alone. At most three circles: with more than three reviewers, two and `+N`. The group is one button that opens a popover listing every reviewer with their verdict in words. Changes requested first, then approved, commented, waiting. The PR's author isn't a reviewer.
- **CI is one summary with the checks behind it.** "✓ CI 12/12 passed", "✕ CI 2 of 12 failed", "◌ CI 3 of 12 running", from `checkSummary` in the domain, the same for both hosts; skipped checks don't count toward the total and are listed as skipped. A click opens a popover: failed first, then running, passed and skipped, each with its name, state in words and a Details link. Nothing shows when the commit has no checks.
- **A check's link is a host-supplied URL,** so it's parsed as `HttpUrl` at the edge, opened in a new tab with `rel="noreferrer noopener"`, and dropped when it isn't http(s). Thread bodies have no links because a PR author writes them; a check's URL is set by a CI integration with write access, and following it is the point of the popover.
- **Nothing new in the bar.** The design's compact header repeats Changes requested; the bar's one row is the stepper's, and the PR's state doesn't change while it's being read. Below 1024px the header's first row wraps, as it already may.
- **A failed read is quiet, never dropped silently.** The whole read failing shows a muted "Status unavailable" where CI and reviewers would be, with the reason in its tooltip and a retry on click; the page is never failed by it. Checks the token can't read (a fine-grained token without Checks or Commit statuses) are `null` with a reason, shown as a muted "CI not readable" with the scope to add.

## Contract change

In its own PR first, with a line in stage 02's **Change log**.

- `src/domain/review/pr-status.ts`:
  - `PrState`: `open | draft | merged | closed`.
  - `Reviewer`: `{ user: HostUser | team name, verdict: approved | changes-requested | commented | null }`, null while only requested.
  - `ReviewStatus`: `approved | changes-requested | null`.
  - `Check`: `{ name, state: passed | failed | running | skipped, url: HttpUrl | null }`.
  - `PrStatus`: `{ state, reviewStatus, reviewers, checks: Check[] | null, checksUnreadable: string | null }`.
  - Pure functions: `reviewStatusOf(reviewers)`, `checkSummary(checks)`, `orderReviewers`, `orderChecks`.
- `src/application/ports/pr-status.ts`: `PullRequestStatus { host; getStatus(ref, headSha) }`, its fake in `src/application/testing/` and a contract suite.
- `contracts/api.ts`: `GET /api/analyses/:id/status` → `PrStatus`.
- ENGINEERING.md's ubiquitous language: *PR state*, *Reviewer* (someone asked to review the PR or who has, with the verdict of their latest review), *Review status* (what the PR's reviews add up to on its host), *Check* (one CI result on a commit). A reviewer's verdict is a *Verdict*, the term the published review already uses.

## Host reads

| | GitHub | Bitbucket Cloud |
|---|---|---|
| State | `pullRequest { state isDraft }` | `.../pullrequests/{id}`: `state`, `draft`; `SUPERSEDED` reads as closed |
| Reviewers | `reviewRequests` (users and teams), `latestOpinionatedReviews` for approve and changes requested, `latestReviews` for commented | The same PR response's `participants`: `role`, `approved`, `state` (`approved`, `changes_requested`) |
| Review status | `reviewDecision` | `reviewStatusOf(reviewers)` |
| Checks | `object(expression: $head) { ... on Commit { statusCheckRollup { contexts(first: 100) } } }`: `CheckRun` and `StatusContext` | `.../commit/{head}/statuses`, 100 a page: `SUCCESSFUL` passed, `FAILED` and `STOPPED` failed, `INPROGRESS` running |
| Requests | One GraphQL query | Two, in parallel |

GitHub's conclusions map as `SUCCESS` passed, `NEUTRAL` and `SKIPPED` skipped, everything else completed as failed, and anything not completed as running. Reads go through the shared retry and timeout wrapper. Record real responses for the fixtures where credentials allow; synthetic ones are marked `synthetic`.

## Tasks

1. **Contract PR:** the types, functions and tests above, the port, the fake, the contract suite, the route's schema.
2. **GitHub adapter:** the query, the schemas, the mapping, fixtures for a PR with mixed checks, one with no checks, one merged, and one whose token can't read checks.
3. **Bitbucket adapter:** the two reads, the mapping, the same four fixtures. Can run beside 2.
4. **Use case and route:** `getStatus(id)` reads the analysis's ref and head and calls the host's port; `host-not-configured` and `not-found` as threads do. Wire both adapters in `src/cli/`.
5. **`usePrStatus.ts`:** the read and its refresh rules (open, publish, focus, 60 s while running and visible).
6. **Header:** the state and review-status badges after the title, through `StatusBadge` and a `PR_STATE` and `REVIEW_STATUS` map in `web/src/lib/status.ts`; `CiSummary` and `ReviewerStack` at the first row's end, after the threads, with a separator between items; their popovers on `web/src/ui/popover.tsx`. Tokens: the `ci-*` ones that exist, the `review-*` verdict ones; a new token only for Merged if no existing one passes, with its pairs in `pnpm check:contrast`.
7. **Dev mock and e2e fake:** statuses for the mock scenarios (one with changes requested and a failing check, one merged), and a status for the fake host in `e2e/`.
8. **Design system page:** the badges in every state; CI passed, failed, running, unreadable, with the popover open; reviewers with one, three and five, with the popover open. Snapshots with `--update-snapshots=all`.
9. **Docs:** ARCHITECTURE.md's host table gains a row, the Review page paragraph names the new items and why the state badge shows Open, and the "CI checks, reviewer avatars … wait for the features that need them" sentence goes. Stage 44's **Not in this stage** points here.

## Accessibility

- Badges carry a glyph and a word. A reviewer's mark has a glyph, and the group's name says it all: "3 reviewers: 1 requested changes, 1 approved, 1 not reviewed yet".
- CI's button is named by its summary in words: "CI: 2 of 12 checks failed, show checks".
- Circles and the CI button are at least 24 px targets.
- A refresh that changes the CI summary is announced politely, so a failure that arrives while reading is heard; a refresh that changes nothing isn't.

## Not in this stage

- Required checks, and whether the PR can be merged.
- Rerunning a check, or reading its logs.
- Requesting a reviewer.
- Checkout and Unified/Split, which stage 44 left out by decision.

## Tests

- **Domain:** `reviewStatusOf` on every mix; `checkSummary` with skipped, all passed, some failed, some running, none; ordering.
- **Contract:** both adapters pass the suite: state, reviewers with each verdict and teams, checks on the given head, no checks, unreadable checks, the author left out.
- **Use case:** a host error is the route's error and the analysis stays readable; unknown analysis and unconfigured host.
- **Page (`ReviewPage.test.tsx`):** the state badge in each state, Open included; the review status badge only when approved or changes requested; CI summary text for each mix; the reviewer stack's overflow; popovers list in order; a failed read shows Status unavailable and retries; a refresh after publish shows the reviewer's own verdict; the 60-second refresh runs only while a check is running.
- **End to end:** the fake host's status shows in the header, and the CI popover opens and closes with Esc.

## Definition of done

- [x] The header shows the PR's state, its review status, its reviewers and CI, on GitHub and Bitbucket.
- [x] A host that can't answer leaves the page working and says the status is unavailable.
- [x] Checked live on delphi-code #2 and a Bitbucket PR, in light, dark and at 1024px. Neither has reviewers or checks, so sindresorhus/ky #868 (closed, changes requested, a bot reviewer, three checks) and #867 (merged) were checked too.
- [x] ARCHITECTURE.md and ENGINEERING.md updated.
- [x] `pnpm check` and `pnpm e2e` pass.

## Notes for later stages

- **Names.** The port is `PullRequestStatusSource` and the data `PullRequestStatus`, as the domain's other PR types are named; the use case and route are `getPullRequestStatus`, `GET /api/analyses/:id/pull-request-status`, since `getStatus` is the server's own status.
- **The components are in `web/src/review/pr/pr-status.tsx`,** with the review components, not in `web/src/pages/review/`; the page reads them through `usePullRequestStatus.ts`.
- **Tokens:** `pr-open` and `pr-merged`, each with a background, in light and dark, with their pairs in `pnpm check:contrast`, and the CI and verdict colors on the page's background. Draft takes the muted tokens and Closed the changes-requested ones. The state badge's icon is lucide's pull request, draft, merge or closed icon.
- **GitHub's `reviewDecision` is null** where a repository requires no review; the status is then derived with `reviewStatusOf`, as on Bitbucket. A reviewer asked again after reviewing keeps their last verdict, as GitHub's own list shows it.
- **Bitbucket's build statuses** make the checks unreadable only when refused or missing; a network failure fails the whole read, so it's retried like any read.
- **At most 100 checks** are read per commit; past that the server logs that later ones are missing.
- **The design system's examples are closed popovers,** each opening on a click: several open popovers overlap. The section isn't snapshotted.
- **Fixtures are synthetic.** The GitHub query was run against microsoft/TypeScript#60000 to check its fields, and its answers on sindresorhus/ky were read live. Bitbucket's PR and statuses answers were read live on super-unique-workspace/very-new-repo #1, which has no reviewers or builds, so a status of each state and a participant with a verdict still want a recording.
