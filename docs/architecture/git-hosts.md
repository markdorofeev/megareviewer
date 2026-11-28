# Git hosts

Supported: **GitHub** and **Bitbucket Cloud**.

The pipeline and UI never talk to a host directly. Each host is a connector behind one interface:

| Operation | GitHub | Bitbucket Cloud |
|---|---|---|
| Get PR (title, description, branch, head SHA) | `GET /repos/{o}/{r}/pulls/{n}` | `GET /2.0/repositories/{ws}/{repo}/pullrequests/{id}` |
| Get commits | `.../pulls/{n}/commits` | `.../pullrequests/{id}/commits` |
| Get diff (unified) | `.../compare/{base}...{head}` at the PR's SHAs, with diff media type, so a push while loading can't mismatch diff and head SHA | `.../diff/{head}..{dest}?topic=true` at the PR's commits: the same three-dot diff the PR's diff endpoint redirects to, pinned the same way |
| Get files at commits | One GraphQL query per 3 files, 6 at a time (`object(expression: "sha:path")`); `.../contents/{path}?ref={sha}` for a file GraphQL truncates or won't give as text | `.../src/{sha}/{path}`, one request per file, 18 at a time |
| List a commit's files with git's hash of each, for the harness | `.../git/trees/{sha}?recursive=1`, unless GitHub cuts it short; a symlink or a submodule isn't a file | No answer has a file's hash |
| Read a harness's files with their hashes | As files at commits, with each blob's `oid` and `byteSize` | As files at commits, the hash computed as git does |
| List a folder's files, for the harness | Only when the commit's list is cut short: `.../git/trees/{sha}%3A{path}?recursive=1`, the colon encoded, since Octokit reads `:name` in a route as a parameter; a file there is refused with 422 | `.../src/{sha}/{path}/?max_depth=20`, 100 a page, at most 10 pages; a file there answers with its text |
| Paths that differ between two commits | Not asked: the list says it | `.../diffstat/{new}..{old}?topic=false`, 500 a page, at most 10 pages |
| List PRs to review | Search API (`review-requested:@me`, `author:@me`) | PRs to review: per repo, the 50 most recently updated of the configured workspace. Own PRs: one workspace-wide call |
| Which PRs opened before are still open | One GraphQL query, a `repository.pullRequest(number)` alias per PR | `.../pullrequests/{id}`, one request per PR, 5 at a time |
| Publish review | One PR review with inline comments and a verdict | Approve or request changes, plus one call per inline comment |
| Revoke approval | Dismiss the user's latest review that approves or requests changes, when it approves (`PUT .../pulls/{n}/reviews/{id}/dismissals`, with "Approval revoked.", which GitHub requires) | `DELETE .../pullrequests/{id}/approve`, when the user's participant entry approves, or their ID is unknown and anyone's does |
| Review threads | GraphQL `pullRequest.reviewThreads`, 100 a page, with each thread's comments | `.../pullrequests/{id}/comments`: an inline comment without a parent starts a thread, `parent.id` chains replies, deleted ones are left out; `fields` asks for who resolved each thread, which the list otherwise leaves out, so a resolution reads `{}` |
| Reply | GraphQL `addPullRequestReviewThreadReply` on the thread's ID | `POST .../comments` with `parent: {id}` |
| Comment now | `POST .../pulls/{n}/comments` with `commit_id` the analysis's head, `line`, `side` and, for a range, `start_line` | `POST .../comments` with `inline` on the last line, the range named in the body |
| Resolve, reopen | GraphQL `resolveReviewThread`, `unresolveReviewThread` | `POST .../comments/{id}/resolve`, `DELETE` the same |
| PR status (state, reviewers, checks) | One GraphQL query: the PR's `state`, `isDraft`, `reviewDecision`, `reviewRequests`, `latestReviews` and `latestOpinionatedReviews`, and the `statusCheckRollup` of the analysis's head commit | `.../pullrequests/{id}` for `state`, `draft` and `participants`, and `.../commit/{head}/statuses`, in parallel |
| The reviewer's past comments | Search API (`repo:{o}/{r} is:pr reviewed-by:@me -author:@me`, by updated), then `.../pulls/{n}/comments` per PR, 6 at a time, the ones by the current user | `.../pullrequests` the user didn't write, by updated, with each one's `participants` through `fields`, 50 a page; the ones the user acted on, then `.../pullrequests/{id}/comments` per PR, 5 at a time, read as threads are |

Both hosts return a unified diff, so hunk splitting and everything after it is shared.

Bitbucket specifics:

- **No cross-repo "waiting for my review" search.** The picker scans the 50 most recently updated repos of the configured workspace. A pasted PR URL always works.
- **Who the user is comes from a workspace.** Listing PRs, the reviewer's own verdict, whether a PR is theirs and their past comments all need their ID. `GET /user` says it, but needs `read:user:bitbucket`, account data megareviewer uses for nothing else, so a token shouldn't have to carry it. `GET /user/workspaces/{ws}/permissions/repositories` names the caller with `read:repository:bitbucket`, which is needed anyway. It's asked in `BITBUCKET_WORKSPACE`, then in the workspace of the PR at hand, and `GET /user` only when neither answers: a workspace the user isn't in refuses, and one where they were given no repository lists none. Dropping `GET /user` was rejected, since a token or app password that has the account scope works without a workspace. So was a variable for the account ID: one more thing to set up, and a wrong one would list someone else's PRs without saying so. When nothing says who the user is, a pasted PR still reviews and publishes, and revoking an approval is left to Bitbucket.
- **Publishing isn't atomic.** Comments are posted one by one, so the server records each posted comment and skips it on retry, avoiding duplicates after a partial failure. The records are per review, so a second review can post on a line the first did.
- **Inline comments anchor on the PR's current diff,** not on a commit. Publishing refuses line comments when the PR has new commits since the analysis, so they can't land on the wrong lines; a verdict or a summary alone goes through.
- **Pull requests can't be filtered by who took part.** `participants.uuid` isn't a field `q` takes, and `reviewers.uuid` is who was asked, not who reviewed: on atlassian/aws-s3-deploy one reviewer was asked on 24 pull requests, acted on 11 of them, and on 1 nobody asked them to. So reading the reviewer's past comments lists the pull requests they didn't write, most recently updated first, and keeps the ones where their `participated_on` is set, which Bitbucket sets on an approval, a request for changes or a comment. It reads no further than the 500 most recently updated.

- **A diffstat's new commit goes first, and it needs `topic=false`.** By default it starts from where the two commits diverged: between two such commits of atlassian/aui it listed the same 432 files in both directions with `topic=false`, and 6 in one of them without. One that's past 10 pages, or that Bitbucket can't produce in time, says nothing, and the harness is walked afresh.
- **A directory answers as a file would.** `src/{sha}/{path}` gives a directory's listing, as JSON, where every file, a `.json` one too, comes as text or binary, so the content type tells them apart. A symlink can't be told from a file, there or in a tree GitHub cuts short, and is read as the host gives it.

Flaky networks: on a lossy link, one dropped request used to fail the whole analysis, and a stalled one could hang for minutes. So:

- **Every read times out after 60 seconds** and fails as a network error.
- **Reads that fail on the network are retried** three times, after 1, 2 and 4 seconds. One wrapper around every host does this, so both hosts share the policy. Other failures, such as a rate limit or a missing PR, are answers and aren't retried.
- **Files come in small batches over several connections.** On a slow link each connection is slow on its own: one 250 KB GraphQL answer took 13 to 18 seconds while GitHub had started answering within 2, and the same files as ten parallel requests took 4 to 8. Through a proxy capping each connection at 20 KB/s, megareviewer #1's 49 files took 21 seconds in batches of 10, two at a time, which was the first version, and 11 in batches of 3, six at a time. On a fast link the smaller batches were no slower (1.2 to 1.9 seconds against 1.8 to 3.6). Batches of 2, eight at a time, gained nothing more. Collect makes the batches of a PR's files, and the adapters those of a harness's, where one call asks for all the files of a hop, so a lost request there retries the hop.
- **Publishing is never retried and has no timeout.** A post that failed on the network may still have been posted, and retrying it would post it twice. The reviewer retries it, and the posted-comment records skip what's already there.
- **Threads and the PR's status follow the same rules.** Reading them is retried like any read; replying, resolving and commenting now are writes, never retried and without a timeout. A reply that failed keeps its text in the field, so sending it again is the reviewer's call.
- **A failed read of the reviewer's past comments keeps what it got.** It's a request per pull request after the list, and the wrapper retries the whole read, so each adapter keeps the comments of the pull requests it had already read, and a retry asks for the list and the rest. On GitHub, 52 comments on 8 pull requests took 10 requests and 2.7 seconds.

