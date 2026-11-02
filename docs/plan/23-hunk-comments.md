# Stage 23: Comments on hunks

**Status:** Not started
**Depends on:** 20
**Unblocks:** —
**Owns:** `src/domain/review/publication.ts`, `web/src/pages/review/PublishDialog.tsx`, the hunk comment parts of `src/application/use-cases/review.ts`, `src/adapters/sqlite/`, `src/adapters/http/`

## Goal

Without the model there are no decisions to comment on, so the reviewer comments on hunks. Those comments are published as inline comments with the verdict, alongside any decision comments when the model ran.

## Read first

- [ARCHITECTURE.md](../../ARCHITECTURE.md) "Publish", "Storage", and the Bitbucket notes on non-atomic publishing
- `src/domain/review/publication.ts`, `src/application/use-cases/review.ts`, `web/src/pages/review/PublishDialog.tsx`

## Contract change

- `CommentKey` accepts `hunk:<HunkId>:<side>:<line>` as well as `summary` and `decision:<id>`.
- A `HunkComment` domain type (hunk ID, side, line, body) and HTTP routes to save and delete one, in `contracts/`.
- A `hunk_comments` table, so drafts survive a reload.

A separate PR, with a line in stage 02's **Change log** and the table in ARCHITECTURE.md "Storage".

## Tasks

1. **Writing.** Clicking a line number in a hunk opens a comment box on that line; `c` opens one on the focused hunk's first changed line. Saved as a draft as the reviewer types, like decision comments.
2. **Publishing.** `buildPublication` adds one inline comment per hunk comment, at its line and side. The summary counts them. The publish dialog lists them with their file and line before anything is posted.
3. **Retries.** Hunk comments are recorded in `published_comments` by key, so a retry after a partial failure skips the ones already posted, as decision comments are.

## Tests

- `buildPublication` with hunk comments only, decision comments only, and both.
- A comment on a deleted line publishes on the old side.
- Partial failure on Bitbucket, then retry: no duplicates.
- Playwright: comment on a hunk, publish with "request changes", the fake host receives the inline comment.

## Definition of done

- [ ] Contract PR as above.
- [ ] Tasks above, with tests.

## Open issues

_None yet._

## Notes for later stages

_None yet._
