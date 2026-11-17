# Stage 57: The reviewer's past comments, from GitHub and Bitbucket

**Status:** Not started
**Depends on:** 55
**Owns:** `ReviewHistory` in `src/adapters/github/` and `src/adapters/bitbucket/`, their fixtures, the port's wiring in `src/cli/compose.ts` and the retry wrapper

## Goal

"Import from my past reviews" reads what the reviewer has already said on a repository's pull requests, so megareviewer can propose preferences from it (stage 55's `importPreferences`). This stage implements the `ReviewHistory` port for both hosts.

Read first: [55-preferences-core.md](55-preferences-core.md), ARCHITECTURE.md's Git hosts, [40-review-threads.md](40-review-threads.md) for how each host's comments are read.

## What it reads

`getReviewerComments(repo, { pullRequests })`: the current user's own comments on the code of the most recently updated pull requests of `repo` that they reviewed and didn't write, newest first, with how many pull requests were read.

| | GitHub | Bitbucket Cloud |
|---|---|---|
| The PRs | Search API: `repo:{o}/{r} is:pr reviewed-by:@me -author:@me`, sorted by updated, the first `pullRequests` | `.../pullrequests?state=OPEN&state=MERGED&state=DECLINED&sort=-updated_on` with `q` on the current user as a reviewer or participant, the first `pullRequests` |
| The comments | `.../pulls/{n}/comments`, the ones by the current user | `.../pullrequests/{id}/comments`, inline ones by the current user, deleted ones left out |

- Only comments on lines of code: a summary or a general comment says less about what the reviewer looks for.
- A reply counts: it's the reviewer's words.
- Bodies as the host has them, with Bitbucket's mentions and editor marks handled as threads do.
- It's a read: retried on network failures and timed out as every read is, through the same wrapper. Requests go a few at a time, as the other per-PR reads do.
- At most 300 comments come back, the newest; the count of pull requests read is the real one, so the page can say "92 comments from 30 pull requests".
- No PRs reviewed is an empty list, not an error. A host that refuses the search (a token without the scope) is the host's error with its fix, as elsewhere.

## Definition of done

- [ ] Both adapters, passing stage 55's `ReviewHistory` contract suite on recorded fixtures, or synthetic ones marked so with the recorder left in place.
- [ ] Wired in `compose.ts` for each configured host, behind the retry wrapper.
- [ ] A live read on a repository the reviewer has reviewed in, on each configured host, recorded here: PRs read, comments found, requests made.
- [ ] `pnpm check` passes.

## Notes for later stages

