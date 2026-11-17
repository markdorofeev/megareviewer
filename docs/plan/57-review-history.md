# Stage 57: The reviewer's past comments, from GitHub and Bitbucket

**Status:** Done (branch worktree-agent-ad7986be5b497c82d, no PR). `pnpm check` passes: 3232 tests; both adapters pass the `ReviewHistory` contract suite on synthetic fixtures; live reads on GitHub and Bitbucket through the composition root's wiring, numbers in the notes
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

- [x] Both adapters, passing stage 55's `ReviewHistory` contract suite on recorded fixtures, or synthetic ones marked so with the recorder left in place.
- [x] Wired in `compose.ts` for each configured host, behind the retry wrapper.
- [x] A live read on a repository the reviewer has reviewed in, on each configured host, recorded here: PRs read, comments found, requests made. On Bitbucket the signed-in user has reviewed nothing, so the read there found none; see the notes.
- [x] `pnpm check` passes.

## Open issues

- **The fixtures are synthetic.** `history.synthetic.ts` in each adapter's fixtures is written from the hosts' docs and the shapes of live answers. A recorded one needs a public repository where the token's owner commented on the code of two pull requests they reviewed: `record-history.ts`, beside each, records it with every comment's text and every name replaced.

## Notes for later stages

### What's built

- `createGitHubReviewHistory` (`src/adapters/github/history.ts`) and `createBitbucketReviewHistory` (`src/adapters/bitbucket/history.ts`), exported from each adapter's index. Each passes `describeReviewHistoryContract`.
- `retryingReviewHistory` in `src/application/retries/`, beside the wrappers of the other host ports, on the same policy: a `network` failure is retried after 1, 2 and 4 seconds, any other answer isn't.
- `createReviewHistories(config, options)` in `src/cli/compose.ts`, as `createReviewThreads` is: an adapter per configured host, each behind the wrapper. `compose` passes it as `history`, so importing from a host that isn't configured still answers "megareviewer can't read past reviews from GitHub".
- Each request times out after 60 seconds in the adapters' clients, as every read does.

### Where the hosts differ from this doc's table

- **Bitbucket can't filter pull requests by who took part.** `q=participants.uuid="…"` answers "Field ".participants.uuid" does not support filtering", and `participants.user.uuid` the same. `reviewers.uuid` can be filtered, but it's who was asked to review, not who did: on atlassian/aws-s3-deploy one reviewer was asked on 24 pull requests, acted on 11 of them, and on 1 nobody asked them to. So the adapter asks for the pull requests the user didn't write, most recently updated first, with each one's participants (`fields=next,values.id,values.updated_on,values.participants.user.uuid,values.participants.participated_on`), and keeps the ones where the user's `participated_on` is set: Bitbucket sets it when someone approves, asks for changes or comments, and leaves it null for a reviewer who was asked and never acted. That's what GitHub's `reviewed-by:@me` means. The filter on `reviewers.uuid` was the alternative: it reads pull requests the user never looked at and misses the ones they reviewed unasked.
- **Bitbucket's list is read a page of 50 at a time until it has the pull requests asked for,** and no further than 10 pages, the 500 most recently updated, which the log says at info when it stops there. A repository where the user reviews often costs one list request; one where they reviewed nothing in its last 500 pull requests costs 10 and answers none.
- **`state` goes in `q`:** `(state="OPEN" OR state="MERGED" OR state="DECLINED") AND author.uuid!="{uuid}"`. Once `q` is set Bitbucket ignores the `state` parameters, measured: `state=MERGED` beside a `q` answered an open pull request. With a `q` that names no state, every state comes back.
- **A reply on Bitbucket carries `inline` in live answers.** The adapter doesn't rely on it: it reads a pull request's comments with the threads adapter's `toThreads`, which puts a reply on its thread's file, leaves out deleted comments and general ones, and names the mentions of people whose comments the pull request has.
- **GitHub needs the current user,** one `GET /user` kept for the process: the REST list of comments carries each author's login and nothing like GraphQL's `viewerDidAuthor`. It's asked beside the search, so it costs no round trip.
- **GitHub reads at most 100 pull requests,** one page of the search. The use case asks for 30.
- **A repository GitHub can't search answers 422,** not 404, whether it's missing or hidden from the token. It comes back as `rejected` with GitHub's words: "Validation Failed: The listed users and repositories cannot be searched either because the resources do not exist or you do not have permission to view them." Bitbucket answers 404, `not-found` with the usual message.

### Decisions

- **A failed read keeps what it got.** The wrapper retries the whole port call, and this read is a request per pull request after the list: for 30 pull requests, one dropped request would otherwise ask for all of them again, up to three times. So each adapter keeps the comments of the pull requests a failed read had already got, by pull request and its update time, for one repository, and drops them when a read succeeds. A retry then asks for the list again and for the pull requests it's missing. Retrying each request inside the adapter was the alternative; the policy is the wrapper's, one for both hosts.
- **Six pull requests at a time on GitHub, five on Bitbucket,** the numbers the files and the opened pull requests are read with.
- **The 300 newest comments are the newest across the pull requests read,** by when each was written, and the count of pull requests is of those read, with or without a comment of the user's on their code. When more than 300 were found the log says how many, at info. `MAX_PAST_COMMENTS` is in each adapter, since adapters can't import each other; the port is where one number would live.
- **Bitbucket's editor mark is dropped in the adapter:** `{: data-inline-card='' }` after a link. A thread leaves it to the page's parser; these bodies go to a model, which no parser reads for. Mentions are named as threads name them. Bitbucket's backslash escapes stay: they're Markdown.
- **A comment with nothing in it is left out,** on both hosts.
- **REST on GitHub, as the table says.** One GraphQL query through `search` and `reviewThreads` could read it all in a request, and is the alternative: it's one large answer, which is what a slow link is worst at (ARCHITECTURE.md, flaky networks), and its comments are capped at 100 a thread.

### Live reads (2026-11-17)

Through `createReviewHistories` on the machine's own credentials, asking for 30 pull requests. Only numbers were kept.

| Host | Repository | PRs read | Comments found | Requests | Time |
|---|---|---|---|---|---|
| GitHub | a private repository the user reviewed in | 8 | 52, on 6 of them | 10 | 2.7 s |
| GitHub | a public repository the user reviewed in | 2 | 1 | 4 (5 with the retried one) | 3.9 s with the retry's wait |
| GitHub | sindresorhus/is, nothing reviewed | 0 | 0 | 2 | 0.7 s |
| Bitbucket | each of the workspace's two repositories | 0 | 0 | 2 | 1.1 to 1.3 s |

- **GitHub:** 10 requests are the user, the search and 8 lists of comments. The answers were 188 KB for 2.9 KB of the reviewer's own words: the REST list sends every comment's diff hunk and links.
- **The wrapper retried a real failure.** On the public repository a connection was refused, the log said "Retrying the reviewer's past comments after a network error" with a 1 second wait, and the read then succeeded: 5 requests where a clean read of it takes 4, so it was the search that was refused, before any comments were read. What a failed read keeps is covered by the adapters' tests, not by this.
- **Bitbucket: the signed-in user has reviewed nothing.** The workspace has one pull request, their own, so the read is the user and one page of the list, and answers none. To see the adapter on real data it was also run on the public atlassian/aws-s3-deploy with `GET /user` answered by one of its reviewers' UUIDs and every other request Bitbucket's own: 12 pull requests read of the 49 listed, 10 comments on 5 of them, 14 requests, 3.1 seconds; asked for 5, it read 5 in 6 requests. No comment kept an unnamed mention or an editor mark.

### Not verified

- **Importing end to end with a model.** `importPreferences` picks the model before it reads the host, and the catalog has no suggester until stage 56, so `POST /api/preferences/imports` still answers `model-unavailable` on this branch. The adapters were read live through the wiring, not through the route.
- **A Bitbucket account that has reviewed,** on its own credentials, and a Bitbucket API token: the machine has an app password.
- **A fine-grained GitHub token.** The read was with `gh`'s OAuth token. The search and the comments need read access to the repository's pull requests.
- **The wrapper in `compose.ts` has no test of its own,** as its siblings have none: `createReviewHistories` is tested for which hosts it answers, `retryingReviewHistory` on the fake, and the two together only by the live read above.

### For the product docs

Nothing was written to ARCHITECTURE.md. Its Git hosts table wants a row:

| Operation | GitHub | Bitbucket Cloud |
|---|---|---|
| The reviewer's past comments | Search API (`repo:{o}/{r} is:pr reviewed-by:@me -author:@me`, by updated), then `.../pulls/{n}/comments` per PR, 6 at a time, the ones by the current user | `.../pullrequests` the user didn't write, by updated, asked for `participants` through `fields`, 50 a page; the ones the user acted on, then `.../pullrequests/{id}/comments` per PR, 5 at a time, read as threads are |

and its Bitbucket specifics that `participants` can't be filtered, with the flaky-networks list saying a failed read of past comments keeps what it got.

### Edits outside this stage's paths

None. `src/application/retries/` is the retry wrapper this stage owns.

