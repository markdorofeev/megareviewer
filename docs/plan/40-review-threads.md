# Stage 40: Review threads on the code

**Status:** In progress (on main): built, and checked live on delphi-code #2; applying a batch on scratch PRs is left
**Depends on:** 23 (line comments), 36
**Owns:** A `ReviewThreads` port and its GitHub and Bitbucket adapters, `src/domain/review/thread.ts`, the thread routes in `src/adapters/http/` and `contracts/`, `web/src/review/thread/`, and the thread wiring in `web/src/pages/review/` (`HunkView.tsx`, `ReviewPage.tsx`)

## Goal

The page shows only the reviewer's own drafts. It never reads the PR's existing review comments, so in a team the reviewer doesn't see what others said, repeats it, and has to go to the host to answer or resolve anything. This stage puts the host's threads on the code they're about, and lets the reviewer reply, resolve, and write and apply suggested changes without leaving the page.

The target design, under the line a thread is on:

- a 3 px left border in the thread's state color;
- per comment: initials, name, an **Author** chip when it's the PR's author, the time relative to now, and a severity chip (`▲ major`) when the comment has one;
- the body: paragraphs, inline code and code blocks;
- a **Suggested change** as a small diff of the lines it replaces, with **Add to batch** and **Apply suggestion**;
- replies under the first comment, divided by a rule;
- a **Reply…** field (`r`) and **Resolve** (`e`).

No model calls and no pipeline change: threads are read live, not with the analysis.

## Read first

- ARCHITECTURE.md: Git hosts (the read and publish rules for flaky networks), Publish, Local server security, UI → Review page
- Stage 23 and its notes: drafts live in local storage, comments go on a deleted line's old number and any other line's new one
- `src/application/ports/git-host.ts`, `src/adapters/github/publish.ts`, `src/adapters/bitbucket/publish.ts`
- `web/src/review/diff/hunk-card.tsx` (`CommentRow`), `web/src/review/pr/comment-composer.tsx`, the mock thread in `web/src/design-system/Screens.tsx`

## Decisions

These need an entry in ARCHITECTURE.md in the PR that makes them (ENGINEERING.md §10).

- **Threads are read live, not cached.** Threads change without a push, so caching them by head SHA would show stale ones. They load once the page opens and again after each write. A failed read is a warning above the code, never a failed page.
- **A port of its own.** `ReviewThreads` (`getThreads`, `reply`, `setResolved`, `applySuggestions`) rather than four more methods on `GitHost`: publishing a review and taking part in a conversation are different use cases (ENGINEERING.md §5, interface segregation). Both adapters implement it, and both pass one contract suite.
- **Replies and resolving post at once; new threads stay drafts.** A reply answers someone now. A new comment belongs to the review the reviewer is writing and is sent with its verdict, as in stage 23. GitHub and Bitbucket work this way too.
- **Writes follow the publish rule.** They're never retried and have no timeout (ARCHITECTURE.md: a post that failed on the network may still have been posted). The field keeps its text after a failure, so retrying is the reviewer's call.
- **Severity is ours, carried in the body.** Hosts have no severity. A comment written here may start with `**major:**`, `**minor:**` or `**blocking:**`, and reading a thread turns exactly that prefix back into a chip. Any other text is left as it is, with no chip, so a severity is never guessed. Nits get no level: DESIGN.md says nits are fixed, not discussed. The level is chosen in the composer, and none is the default.
- **Suggestions use the host's own format.** That's a ` ```suggestion ` fenced block, which GitHub renders natively, so a suggestion written here reads correctly on the host and the other way round. The diff's removed side is the lines the comment covers, read from the file contents the analysis already holds at the comment's commit.
- **Applying a suggestion commits through the host's API, never locally.** The checkout is never changed (ARCHITECTURE.md, Local checkout). The commit is made on top of the analysis's head SHA. If the branch has moved since, applying is refused, just as publishing refuses a stale analysis, so a suggestion never lands on code nobody looked at. The batch is one commit: "Apply N suggestions from code review". The buttons are shown only to someone the host lets push: GitHub's `viewerCanUpdate`, Bitbucket's write permission. Anyone else sees the suggestion read-only.
- **Bodies are untrusted host content.** They're rendered with a small parser of our own that understands paragraphs, inline code, fenced code (syntax-colored like the diff) and suggestion blocks. It never uses `dangerouslySetInnerHTML`, and everything else stays literal text, links included. It adds no dependency.
- **Initials, not avatars.** Avatar images come from the host's CDN, which the CSP (`'self'` only) blocks and which would tell the host who's looking. The initials circle is built from the display name.

## Host APIs

| Operation | GitHub | Bitbucket Cloud |
|---|---|---|
| Threads | GraphQL `pullRequest.reviewThreads`: `id`, `isResolved`, `isOutdated`, `path`, `line`, `startLine`, `diffSide`, `viewerCanResolve`, `viewerCanReply`, comments with `author`, `body`, `createdAt`, `originalCommit`. One query, paginated by 100 | `GET .../pullrequests/{id}/comments`, where a comment with `inline` starts a thread and `parent.id` chains replies. `inline.from` is the old line and `inline.to` the new one. `resolution` says it's resolved. `deleted` comments are skipped |
| Reply | `POST .../pulls/{n}/comments/{id}/replies` | `POST .../comments` with `parent: {id}` |
| Resolve, reopen | GraphQL `resolveReviewThread`, `unresolveReviewThread` | `POST .../comments/{id}/resolve`, `DELETE` the same to reopen |
| Apply | Git Data API: a blob per file, a tree on the head's tree, a commit whose parent is the head SHA, then `PATCH refs/heads/{branch}` without `force`, which fails if the branch moved | `POST /2.0/repositories/{ws}/{repo}/src` with `branch`, `parents={head}` and the files, which fails if the parent isn't the tip |

A fork's PR branch lives in the fork. The adapter pushes to the source repository, and the host decides whether the token may.

## Tasks

1. **Contract PR** (a line in stage 02's **Change log**). This adds:
   - in `src/domain/review/thread.ts`: `ReviewThread` (id, path, side, line, start line, resolved, outdated, what the viewer may do, comments), `ThreadComment` (id, author `HostUser`, body, created time, original commit) and `Severity`;
   - the `ReviewThreads` port and its fake in `application/testing`;
   - in `contracts/`: `GET /api/analyses/:id/threads`, `POST .../threads/:threadId/replies`, `PUT .../threads/:threadId/resolved` and `POST .../suggestions/apply`. The last takes the suggestions' comment IDs and answers `stale-analysis` like publish;
   - in `HunkComment`: an optional `severity` and an optional `suggestion` (the replacement lines). Publishing writes them into the body.
2. **Body parsing in the domain:** the severity prefix, suggestion blocks, code spans and fences, as pure functions with tests that try to break them. A suggestion block that doesn't close is shown as text, never applied.
3. **Adapters,** with recorded fixtures, or synthetic ones marked as such, for threads with replies, a resolved thread, an outdated thread, a deleted Bitbucket comment, and a refused apply. Reads go through the retrying wrapper; writes don't.
4. **Use cases:** `GetThreads`, `ReplyToThread`, `ResolveThread` and `ApplySuggestions`. The last checks the head SHA first and builds the new file contents from `file_contents` at that SHA.
5. **Thread component** in `web/src/review/thread/`, matching the design. It needs every state in `/design-system.html`, on made-up data: open, resolved (collapsed to one line saying who resolved it), outdated, with a suggestion, read-only, a reply that's posting, and a failed reply.
6. **On the page.** A thread goes under its line in the file card. A thread on lines the diff doesn't show, or an outdated one, goes in an "Earlier comments" list at the bottom of its file's card, with the lines it was on. Threads are never dropped. The tree row and the file card's header count a file's open threads.
7. **Keys,** all in `keymap.ts` under a new `thread` scope that's active when the focus is in a thread:
   - `r` reply. `r` already rejects a decision in the `decision` scope; the two scopes never hold the focus at once.
   - `e` resolve or reopen.
   - `b` add to batch.
   - `⌘↵` send.
   - Moving between threads with `]` and `[` is an option. Decide it with the reviewer.
8. **Composer.** The stage 23 comment box gets a severity choice and a "Suggest a change" toggle that starts with the commented lines. It needs a line range: the diff grid's ⇧ selection already gives one. GitHub sends it as `start_line`/`start_side`. Bitbucket can't anchor a range, so it anchors on the last line, quotes the range in the body, and the composer says so.
9. **Batch.** "Add to batch" collects suggestions. The batch shows "Apply 3 suggestions" in the header with a preview of the files it changes, and applies them in one commit. Two suggestions on overlapping lines can't be in one batch, and the second says why. After applying, the page offers to re-analyze the new head.

## Tests

- Domain: severity prefixes, including near misses (`**Major:**`, `major:`, the prefix in the middle of the body) that must get no chip. Suggestion blocks that don't close, are nested, or are empty. Overlapping suggestions in a batch.
- Contract suite per adapter: thread shape, replies in order, resolve and reopen, an apply refused on a moved branch, and no retry on a write that failed on the network.
- Use cases: apply refuses a stale analysis. A failed thread read leaves the analysis readable.
- Components: each state above, keys in the `thread` scope, and a body with `<script>` and `[link](javascript:…)` rendered as text.
- Playwright against the fake host: reply, resolve, and add two suggestions to a batch and apply them. The fake receives one commit whose parent is the head SHA.

## Definition of done

- [x] `pnpm check` passes, including `pnpm check:contrast` for the thread border, the chips and the suggestion diff.
- [x] On delphi-code #2, with comments left on GitHub by hand, every thread shows on its line or under "Earlier comments", and replying and resolving show up on GitHub.
- [ ] Applying a batch on a scratch PR makes one commit on GitHub and one on Bitbucket.
- [x] ARCHITECTURE.md: the host table gets the thread rows; Publish says replies post at once; and the decisions above are recorded with the alternatives rejected.

## Open issues

- **Bitbucket suggestions.** It isn't confirmed that Bitbucket Cloud's suggested changes are stored as a `suggestion` fence in the comment body. Record a fixture from a real suggestion before writing the Bitbucket parser. If the format differs, Bitbucket shows suggestions as code blocks until it's read.
- **Bitbucket resolve.** The `/resolve` endpoint and the `resolution` field need confirming against a recorded fixture as well.

## Notes for later stages

- **GitHub replies use GraphQL.** `addPullRequestReviewThreadReply` takes the thread's node ID, so replying needs no lookup of the first comment's REST ID. Resolving was GraphQL already.
- **`viewerCanUpdate` is per PR,** so every thread of a PR has the same say on applying. Bitbucket's `canApply` reads the permission on the PR's own repository, not a fork's; for a fork's PR the host decides when the commit is made.
- **The removed side of a suggestion comes from the diff's lines,** not from `file_contents`: the page has the lines it shows, and a suggestion is almost always on them. When a part doesn't show every covered line, only the suggestion's lines are drawn. Applying reads `file_contents` as planned.
- **A file keeps its mode:** the GitHub adapter reads the head tree's entries for the changed files' directories in one GraphQL query, so an executable stays one.
- **`[` and `]` between threads aren't built.** Waiting for reviewers to ask for them, as the task said.
- **A range isn't highlighted on its lines;** the comment box says "Lines 31–33". ⇧-click on a second line number of the same side makes the range, on the map's own cards rather than the diff viewer's grid, which the page doesn't use.
- **The composer's controls are in the line comment box** (`CommentRow` in `hunk-card.tsx`): it closes when the focus leaves the box, no longer when it leaves the text field, so Tab reaches the severity and the suggestion toggle.
- **Fixtures are synthetic** (`threads.synthetic.ts` in each adapter's fixtures), built from the adapters' own query strings so GraphQL bodies match. The open issues above still stand: Bitbucket's suggestion format, `/resolve` and `resolution`, and `inline.outdated` need a recorded response.
- **The fake app and the mock API have threads:** small-feature (`smallFeatureThreads`) on the fake hosts, and `web/dev/fixtures/threads.ts` for `pnpm dev:web:mock`. `GET /__fake/commits` lists the commits the fake hosts made.
- **Live on delphi-code #2 (2026-11-11):** three comments left by hand, one with a suggestion and one with a pasted image, each showed under its line, with the suggestion's diff and buttons. A reply sent with `r` and ⌘↵, resolving and reopening with `e` all showed up on GitHub. It found one bug: GitHub gives a one-line thread a `startLine` equal to its `line`, which read as "lines 30–30"; the adapter now drops it.
- **Attachments show in threads.** Images and GitHub's videos in the host's own attachment store load through `GET /api/analyses/:id/attachment` (`ReviewThreads.getAttachment`, `attachmentHost` in the domain); other image URLs are only named. The doc's "the CSP (`'self'` only) blocks" avatars was wrong: `img-src` allows `https:`. Checked live on delphi-code #2, where a pasted screenshot shows in its thread. Bitbucket's `/images/` URL shape and whether it takes Basic auth need confirming against a real attachment, and a 33-second video on delphi-code #2 plays and seeks both ways, served in byte ranges from the last 100 MB kept in memory.
- **Left from the Definition of done:** a batch applied on a scratch PR on GitHub and on Bitbucket. It pushes to real repositories, so it waits for the owner.
