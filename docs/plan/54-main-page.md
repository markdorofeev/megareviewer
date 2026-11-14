# Stage 54: The main page: lists, connections in the header, review activity

**Status:** Not started
**Depends on:** 13, 23, 46, and 40's replies and Comment now, which are on main
**Owns:** `web/src/pages/picker/`, `web/src/app/Header.tsx` and the Connections button beside it, `src/domain/review/activity.ts`, `parsePullRequestUrl`'s scheme rule, the `thread_posts` table and the activity read in `src/adapters/sqlite/`, the activity use case and route, the `picker` scope in `web/src/lib/keymap.ts`, the activity tokens in `web/src/styles/globals.css`, the page's examples in `web/src/design-system/`, its e2e spec

## Goal

The main page is where a reviewer picks a pull request and starts reviewing it, within seconds of opening it. Today it's a URL field, a setup strip that always shows, and two lists of equal weight. This stage rebuilds it after the `hunk-home-v3` design:

```
megareviewer                                              [✓ All connected ⌄]  Display
[🔗 Paste a GitHub or Bitbucket pull request link        /]  [Analyze]
┌ To review  7  Waiting for your review ──────┐ ┌ Your pull requests  3  Open ─┐
│ Prorate seat changes mid-cycle…     GitHub  │ │ Add exponential backoff…     │
│ acme/billing #1291 (JK) jkim 8 min ago      │ │ acme/scheduler #482 (MD) you │
└─────────────────────────────────────────────┘ └──────────────────────────────┘
┌ Review activity  Last 26 weeks       posted from megareviewer on this machine ┐
│ a square per day, 26 weeks              222 PRs reviewed  673 comments posted │
└───────────────────────────────────────────────────────────────────────────────┘
```

It adds review activity, a calendar of the reviews and comments the reviewer posted, so they see what they've done and come back to do more.

The design handoff (`index.html`, `states.html`, `activity.html` and their screenshots) isn't in the repository. This doc carries everything it decides; where the two differ, **Decisions** says why.

## Decisions

- **The name stays megareviewer.** The design says Hunk, the design system's working name.
- **Connections is a button in the header, on every page,** with a popover behind it. It replaces the header's status dot and the picker's setup strip, which showed four lines on every visit to a reviewer whose setup works.
- **No Connect, Reconnect, Manage or Details buttons.** The design has them; megareviewer reads credentials from the environment and holds none of its own, so a button would have nothing to do. A row says what's wrong and how to fix it, and one Check again reads the status again. Entering credentials in the page was the alternative: a store for secrets, which ARCHITECTURE.md's credentials section rules out.
- **Claude unavailable is optional, not an issue.** The design marks it amber, "Hunk needs Claude to analyze pull requests". DESIGN.md decides the opposite: the review works without the model. Only a missing git host, when neither is configured, is an issue.
- **Nothing about a credential reaches the page.** The design shows "key ••4f2a" and Jira's site; the status has neither, and gains neither.
- **No account avatar in the header.** megareviewer has a user per host, not an account; each host's row names its user. The Display menu, which the design leaves out, stays at the row's end.
- **No "Press / to paste a link" in the header.** The field shows the key itself, and the header is shared with the review page, where `/` filters the tree.
- **No sparkles on Analyze or in the calendar's empty note.** Sparkles mean Claude on the review page, and neither runs the model.
- **Analyze validates on submit, and is never disabled.** A disabled button doesn't say why; an error under the field does. Validating as the reviewer types, with the button disabled, was the version before.
- **The Refresh button goes.** The lists are read when the page opens, on Retry, on Check again, and when the tab becomes visible again more than 2 minutes after the last read. Reading on every focus was the alternative: Bitbucket's list is a request per repository, on a limit shared with reviews.
- **Activity is derived from what's already recorded,** not written twice. A review is a row of `publications`, a review's comment a row of `published_comments`: both are already the idempotent record that makes publishing safe to retry, so a retry can't count twice. Replies and Comment now are recorded nowhere, so they get one table, `thread_posts`. A table of activity events written beside the others was the alternative: two writes to keep in step on a publish that isn't atomic on Bitbucket.
- **Days are the reviewer's local days.** The server returns timestamps and the page sorts them into days, since a day's edges depend on the browser's time zone, with daylight saving inside 26 weeks.
- **The calendar shades by pull requests reviewed and names comments in words.** Two numbers can't share one square's shade. Each square's tooltip and name carry both, and the totals beside the calendar count both.
- **Activity is what the reviewer did, never a score.** No streaks, goals, ranks or comparisons between people: a count that rewards approving fast would work against the mission.
- **"PRs this week" is the calendar's last column,** Sunday to today. The design's script sums the last 7 days under that label.
- **The tooltip is the system's,** so the pointer can move onto it and Esc closes it (WCAG 1.4.13). The design's ignores the pointer.

## Contract change

In its own PR first, with a line in stage 02's **Change log**.

- `src/domain/review/activity.ts`:
  - `ReviewActivity`: `{ reviews: { at: Timestamp, pullRequest: PullRequestRef }[], comments: Timestamp[] }`.
  - `ActivityDay`: `{ date: "YYYY-MM-DD", pullRequests: number, comments: number }`.
  - Pure functions: `activityDays(activity, { today, weeks, dayOf })`, which returns every day from the Sunday `weeks - 1` weeks back to today; `activityLevel(pullRequests)`, 0 to 4; `activityTotals(days)`. `dayOf` turns a timestamp into a local date and is passed in, so the domain reads no time zone.
- `AnalysisStore`: `recordThreadPost(id, kind: "reply" | "comment")` and `getReviewActivity(since: Timestamp)`, with the fake's.
- `contracts/api.ts`: `GET /api/review-activity` → `ReviewActivity`, for the last 27 weeks: 26 shown and one of margin for the time zone.
- `parsePullRequestUrl` accepts a link without a scheme (`github.com/acme/web/pull/3307`) as if it had `https://`. Anything else it refused, it still refuses.
- `web/src/lib/keymap.ts`: a `picker` scope.
- ENGINEERING.md's ubiquitous language: *Connection* (a service megareviewer reads from, GitHub, Bitbucket, Claude or Jira, and whether it works) and *Review activity* (the reviews and comments the reviewer posted from megareviewer on this machine, by day).

## What counts

| Counted | When | Read from |
|---|---|---|
| A pull request reviewed | The day a review of it was published, whatever its verdict. Once a day per pull request, however many reviews it got that day | `publications` joined to `analyses` |
| A comment with a review | The day it was posted. The review's summary isn't a comment | `published_comments`, every key but `summary` |
| A comment posted now, a reply | The day the host accepted it | `thread_posts`, written by `postComment` and `replyToThread` after the host answers |

- Resolving a thread counts as nothing.
- A post that failed isn't counted. One whose answer was lost on the network isn't either, since nothing says it landed.
- Reviews and their comments from before this stage show from day one. Replies and Comment now count from this stage on.

## Layout

- **Order:** header, the URL field, the two lists, review activity. The page is `max-w` 1240 px, centered.
- **Surfaces:** the page is `surface-subtle` in light and `background` in dark, cards are `card`, and the header takes `background` on both pages.
- **Lists** sit side by side from 1024 px up, To review 1.55 parts to Your pull requests' 1, and stack below.
- **At 1280 × 800 the first row of each list ends above 300 px,** with the popover open or closed and a failure note showing.
- **No horizontal page scroll** at 1440, 1280, 1024, 768, 640 and 375 px.
- **Below 640 px:** Analyze goes under the field at full width, and a row's right side goes under its text.
- **One `h1`, "Pull requests",** for screen readers only.

## Connections

One button in the header, built on `web/src/ui/popover.tsx`.

| Connection | Working | Failing | Not connected | Optional |
|---|---|---|---|---|
| GitHub, Bitbucket | Configured and its user read. Detail: the user's name, how many of its pull requests are listed, when | Configured and `error` set. Detail: the error | Not configured, and the other host isn't either | Not configured while the other host works |
| Claude | `model.available`. Detail: `model.via` | — | — | Unavailable. Detail: `model.reason`, which says how to fix it |
| Jira | Configured. Detail: "Links tickets" | — | — | Not configured |

An unconfigured connection's row says how to connect it: the variables to set (as `setup.ts` lists them today), then "restart megareviewer". Failing and not connected are issues; optional isn't.

| The button | When | Looks |
|---|---|---|
| ◌ Checking… | The status isn't read yet, or is being read again | Muted, a spinner |
| ✓ All connected | All four work | Outline, the check in `ci-success` |
| ✓ 3 of 4 connected | No issue, and one or more optional | The same |
| ⚠ 1 issue, 2 issues | An issue, none failing | `review-pending-bg`, `review-pending` border and text |
| ⚠ 1 issue, 2 issues | Any failing | `review-changes-bg`, `destructive` border and text |
| ⚠ Disconnected | The status request failed | As failing |

- **Its name says it all:** "Connections: 1 failing · 1 not connected · 2 working. Open to fix.", or "… Open for details." without an issue.
- **The popover** is 340 px wide, never wider than the window less 24 px, under the button and aligned to its right. It holds:
  - a heading, "Connections";
  - a summary: "All 4 working · checked 2 min ago", "3 working · 1 optional · checked 2 min ago", "1 failing · 1 not connected · 2 working", "Checking 4 connections…";
  - the four rows: failing first, then not connected, then the rest in the order GitHub, Bitbucket, Claude, Jira;
  - Check again, and the version, "megareviewer 0.2.1".
- **A row** has its icon, name and state, as an icon and a word: ✓ Connected, ⚠ Failing, ◌ Not connected, a spinner and Checking…. Under it, one line of detail.
  - A broken row has its state's tinted background and a 3 px rule at its edge, and says what happened, then how to fix it.
  - An optional row is muted: "Not connected · Optional", what it adds, and how to connect it.
  - While checking, a row keeps its last detail.
- **Disconnected** shows no rows: "megareviewer's server isn't answering", the error, and Check again.
- **Check again** reads the status and the lists again.
- **Keys:** Enter, Space or a click opens and closes it; Esc or a click outside closes it, and Esc puts the focus back on the button; Tab goes from the button into the popover.

## URL field

A search form, "Open a pull request by link": a field with a link icon, the placeholder "Paste a GitHub or Bitbucket pull request link" and a `/` key hint at its end, and a primary Analyze button, 36 px high. `/` focuses the field and selects its text, unless the reviewer is typing elsewhere. The message under the field is a polite live region.

| State | Field | Button | Message |
|---|---|---|---|
| Empty | — | Analyze | None |
| Submitted empty | Invalid, `destructive` border | Analyze | ⚠ "Paste a pull request link first." |
| Submitted, not a PR link | The same | Analyze | ⚠ "That isn't a pull request link. Use github.com/owner/repo/pull/123 or bitbucket.org/workspace/repo/pull-requests/45." |
| Starting | Read-only | A spinner, "Analyzing…", busy | A spinner, "Fetching acme/api #902 from GitHub…" and Cancel |
| Failed | Editable | Analyze | ⚠ "Couldn't open acme/api #902: " and the error's message, then Try again |

- An invalid state clears on the next keystroke, and the focus stays in the field.
- Cancel stops waiting, makes the field editable and focuses it. The server can't be stopped; an analysis it started anyway is cached for next time.
- Try again submits the same link.
- A host that isn't configured fails with "… isn't configured." and a link, Open Connections.
- On success the page goes to `/review/:id`.

## Lists

Two cards, each with a header: its title, a count of its rows in a pill ("7", named "7 pull requests"), and a muted word, "Waiting for your review" or "Open".

**A row** is a button, at least 58 px high:

- its title, medium weight, one line, cut with an ellipsis;
- under it: `owner/repo #n` in mono, the author's initials in a 20 px circle, their name ("you" on the reviewer's own), and the time since the last update ("8 min ago", "1 h ago", "yesterday", "2 days ago"), a `<time>` with the full date as its title;
- at its right: the host, GitHub or Bitbucket, as an outline badge; with the keyboard's focus, an Enter key hint; under the mouse or the focus, a chevron, and the row takes `accent`;
- in a card narrower than 480 px, the host badge moves to the end of the second line;
- its name: "Move checkout form to server actions. acme/web #3307 by lsato, updated 25 min ago, GitHub".

Rows are in the order the server gives, most recently updated first, and none is cut off.

| State | To review | Your pull requests |
|---|---|---|
| Loading, first read | 5 skeleton rows, the count "…", a spinner and "Loading from GitHub and Bitbucket" (the configured hosts) | 3 skeleton rows, "…", "Loading" |
| Reading again | The rows stay as they are | The same |
| Rows | As above | As above |
| Empty | An inbox icon, "Nothing is waiting for you", "When someone asks for your review on GitHub or Bitbucket, it appears here. To review something else, paste its link above." | A pull request icon, "No open pull requests", "Pull requests you open on GitHub or Bitbucket appear here." |
| No git host configured | "Connect GitHub or Bitbucket to list pull requests." and Open Connections | The same sentence, without the button |
| One host's list failed | An alert above the rows: "**Couldn't load Bitbucket pull requests.**" the error, "GitHub pull requests are shown." and Retry. The muted word is "GitHub only" | The rows, and "GitHub only" |
| One host is failing in Connections | A note above the rows: "Bitbucket pull requests are hidden until Bitbucket works again." and Fix…, which opens Connections with the focus on Check again. "GitHub only" | The rows, and "GitHub only" |
| Every host failed | A note per host, no rows, no empty state, no count | "Couldn't load pull requests." and no count |
| The request failed | "Couldn't list pull requests." the error, and Retry | The same |
| A read again failed | The rows from before stay, under the failure's note | The same |

**Starting a review** from a row:

- The row takes `diff-hunk-bg`, and its right side becomes a spinner with "Opening review…" in `diff-hunk-fg` and a muted "Esc to cancel". It's busy, and "Opening acme/web #3307" is announced.
- Esc puts the row back, announces "Cancelled", and leaves the focus on it. As with the field, only the waiting stops.
- Starting another row, or submitting the field, cancels the one starting. A click on the starting row does nothing.
- When it fails, the row goes back, and an alert above its list's rows says "Couldn't open acme/web #3307: " and the error, with Try again. It goes when another start begins.

**Keys:** each list is one Tab stop. ↑ and ↓ move between its rows, Home and End go to its first and last, Enter opens. The focus doesn't cross from one list to the other with the arrows.

## Review activity

A card under the lists. Its header: "Review activity", "Last 26 weeks" with the number of weeks shown, and at the row's end a laptop icon with "Reviews and comments posted from megareviewer on this machine", which wraps to its own line below 640 px.

**The calendar:**

- A column per week, Sunday at the top, today in the last column. Days after today aren't drawn.
- Squares are 20 px in 24 px cells, with a 4 px radius. Mon, Wed and Fri label the rows; a month's name sits over the column where it starts, and over the first column only when that column starts in the month's first week.
- As many weeks as fit, 8 at least and 26 at most, counted from the card's width with a `ResizeObserver`, less the totals' 260 px column from 900 px up. The header and the totals follow the weeks shown.
- Five levels, by pull requests reviewed that day:

| Level | Pull requests | Square |
|---|---|---|
| 0 | 0 | Hollow: `card` with an `input` border |
| 1 | 1 | `activity-1`, `primary` border |
| 2 | 2 | `activity-2`, `primary` border |
| 3 | 3 or 4 | `activity-3`, `primary` border |
| 4 | 5 or more | `primary`, with a dot of `primary-foreground` in its middle |

- `activity-1` to `activity-3` are new tokens: `primary` mixed into `card` at 22, 46 and 72%, resolved to a hex per theme. On the design's cards they're `#D8D6F9`, `#AEAAF3`, `#807AEC` in light and `#2C2C48`, `#494A7E`, `#696BB9` in dark; dark is mixed again here, since this repo's dark card is `#1F1F1F`.
- Today has a 2 px `foreground` outline, 1 px off the square.
- **The legend** under it: "PRs a day", then five 16 px squares over "0", "1", "2", "3–4", "5+".
- **The tooltip,** on hover and on focus, above the square and kept inside the card: "**Wed, Oct 21**", then "7 PRs reviewed · 26 comments". Singulars read "1 PR reviewed · 1 comment"; a day without reviews, "No PRs reviewed · 0 comments". The square under the mouse has a `foreground` ring.
- **A square's name** is the same in one line, "Oct 21: 7 PRs reviewed, 26 comments", with "(today)" on today's.

**The totals,** beside the calendar from 900 px up and under it below: four across from 520 px, two by two under that. Each is a number over its label, for the weeks shown:

- PRs reviewed, the sum of the days' counts;
- comments posted;
- days with reviews;
- PRs this week;
- under a rule, "Busiest day: Oct 21, 7 PRs and 26 comments.", the day with the most pull requests reviewed, the latest on a tie. It's left out when no day has a review.

| State | Shows |
|---|---|
| Loading | The card and its header, with a skeleton as tall as the calendar, so nothing moves when it arrives |
| Failed | "Couldn't read your review activity.", the error, and Try again, in the card |
| Nothing in 26 weeks | Every square hollow, "0 PRs reviewed" and "0 comments posted", and a muted box: "**No reviews yet.** Open a pull request above and post your review. Each day you review fills a square here." |
| Nothing in the weeks shown, something earlier | Hollow squares and four zeros, without the box |
| Comments but no reviews | Hollow squares, the comments counted, no busiest day |
| A day with none | A hollow square; its tooltip says "No PRs reviewed · 0 comments" |
| A busy day | The level 4 square with its dot |

It's read when the page opens and with the lists' reads after that.

**Keys:** the grid is one Tab stop, on today at first. ← and → move a week, ↑ and ↓ a day, running on into the next or previous week at a column's end; Home goes to the first day shown and End to today; Esc closes the tooltip. When a resize changes the weeks shown, the focused day keeps the focus if it's still there, and the first day shown takes it if not.

## Accessibility

- **Never color alone.** A connection's state is an icon and a word. A day's level is also its hollow square or dot, the legend's numbers, and the numbers in its tooltip and name.
- **The calendar is a grid:** `role="grid"`, named "Review activity for the last 26 weeks, one square per day. Use arrow keys to move between days.", a row per weekday, a `gridcell` per day.
- **Announced politely:** the field's message, "Opening …" and "Cancelled" for a row, and a change of the Connections button's label after the first read.
- **Alerts:** a host's list that failed and a start that failed. A host hidden because its connection is failing is a status, since Connections already says it.
- **Contrast,** added to `pnpm check:contrast` for light and dark: `primary` and `input` borders on `card` at 3:1, the level 4 dot on `primary` at 3:1, the three new steps in order of luminance, each button tone's text on its background at 4.5:1, and the page's text on `surface-subtle`.
- **Targets** are 24 px or more: the popover's links, the field's Cancel and Try again, and a day's cell, which is the target around its 20 px square.
- **Focus** is the system's 2 px outline. A spinner turns slower and a skeleton stops pulsing under reduced motion.

## Tasks

1. **Contract PR:** the activity types and functions with their tests, the store's two methods and fake, the route's schema, the URL's scheme rule, the keymap scope, the ubiquitous language.
2. **Store and use cases:** the `thread_posts` migration, `recordThreadPost` from `postComment` and `replyToThread`, `getReviewActivity` and its route.
3. **Connections:** `connections.ts` beside the header, a pure function from the status to the rows and the button, replacing `statusIndicator` and the picker's `setup.ts` and `SetupStatus.tsx`; the button and its popover.
4. **The page:** the URL field, the row, the lists and their states, the starting row. Can run beside 3.
5. **Review activity:** the tokens and their contrast pairs, the calendar, legend, tooltip and totals. Can run beside 3 and 4.
6. **Dev mock and e2e fake:** an activity for an active reviewer and a new one, a status per button state, a list with a failed host.
7. **Design system page:** a row in each state, each list state, the field's states, the Connections button in its six states with the popover open on a click, the calendar for an active and a new reviewer with a tooltip. Snapshots with `--update-snapshots=all`.
8. **Docs:** ARCHITECTURE.md's PR picker paragraph and its storage table, and DESIGN.md's decision on the main page with the alternatives above.

## Not in this stage

- Entering or changing credentials in the page.
- A row per model provider. Stage 51's catalog would give them; until then Claude's row reads `status.model`.
- More about a pull request on its row: size, CI, review status, new commits since the reviewer's last review.
- Reviews in progress, with drafts not yet published.
- Activity from other machines or from reviews made on the host.
- A row that opens in a new tab: it has no address until its analysis starts.
- A cap or paging on long lists.

## Tests

- **Domain:** `activityDays` on a pull request reviewed twice in a day and on two days, a comment at 23:59 and at 00:00 local, a daylight-saving change, today mid-week, nothing at all; `activityLevel` at 0, 1, 2, 3, 4, 5 and 7; `activityTotals` with a tie for the busiest day, without reviews, and "this week" on a Sunday; a link without a scheme, and that one with `http://` or a port is still refused.
- **Store (contract suite):** a review, its comments less the summary, a reply and a comment posted now all come back from `getReviewActivity`; nothing before `since`; a publish retried counts its comments once.
- **Use cases:** a reply or comment the host refused records nothing; the route's answer on an empty store.
- **Connections:** the pure function on every row of both tables, with neither host configured, both failing, and the status failed.
- **Page (`PickerPage.test.tsx`):** every row of the field's and the lists' tables; a row started, cancelled with Esc, replaced by another, failed; arrows inside a list and not across; `/`; the reads on visibility, and none inside 2 minutes; the calendar's weeks at a narrow and a wide card, its tooltip on hover and focus, its keys, each state of its table.
- **Header:** the button's label, tone and name in each state; the popover's order; Esc returns the focus; Check again reads again.
- **End to end:** open the page, start a review from a row and from a link; the fold at 1280 × 800; no horizontal scroll at the six widths; the Connections popover with the keyboard; the a11y checks on the page in the four combinations of theme and palette.

## Definition of done

- [ ] The main page matches this doc in light and dark, at 1440, 1024, 640 and 375 px.
- [ ] Every state in the tables above is on the design system page or in a test.
- [ ] A reply and a comment posted now show in the calendar the same day.
- [ ] Checked live with GitHub and Bitbucket configured, with one unconfigured, and with a rejected token.
- [ ] The header's button works on the review page too.
- [ ] ARCHITECTURE.md, DESIGN.md and ENGINEERING.md updated.
- [ ] `pnpm check` and `pnpm e2e` pass.

## Notes for later stages

_None yet._
