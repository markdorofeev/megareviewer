# Bitbucket fixtures

Each JSON file is a list of exchanges in the format of `createFixtureFetch` (`src/application/testing/`).

| File | Source |
|---|---|
| `read.json` | Recorded with `record.ts` from [atlassian/bitbucket-upload-file#26](https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/26), a merged five-file PR in a public repo, plus a missing file and a missing PR in the same repo. Bodies keep only the fields the adapter reads. Display names are replaced with `user-<uuid prefix>`, git authors' names and emails with the same pseudonym, and `…-by:` trailers in commit messages with `someone`. |
| `list.synthetic.json` | Written from Bitbucket's API docs: the user's repository permissions in the workspace, the workspace's repositories, the reviewer query per repository, and the workspace's PRs by author, for a made-up `acme` workspace. Recording would capture the token owner's account and workspace. |
| `publish.synthetic.json` | Written from Bitbucket's API docs for creating PR comments and requesting changes, against #26's diff. Recording would post real comments. |
| `resolved-threads.json` | Recorded from [atlassian/trigger-pipeline#56](https://bitbucket.org/atlassian/trigger-pipeline/pull-requests/56), a public PR with four resolved threads, one resolved by someone other than its author. The comments list twice: with `fields` asking for `resolution.user` and `resolution.created_on`, as the adapter asks, and without, where every resolution is `{}`. Bodies keep only the fields the adapter reads; names and account IDs are replaced with `user-<uuid prefix>` and `account-<uuid prefix>`, and comment text with `Comment N.` |
| `history.synthetic.ts` | Written from Bitbucket's API docs and from the shapes of live answers, for the made-up `acme` workspace: the PR list asked for its participants, on two pages, the comments of the three PRs the user acted on, a repository with nothing reviewed, and the 404 for one the credentials can't see. Recording would capture the credentials' owner's own comments; `record-history.ts` records a read with every comment's text, every name and the owner's UUID replaced, from a public repository. |
| `harness.json` | Recorded with `record-harness.ts` from [atlassian/bitbucket-upload-file](https://bitbucket.org/atlassian/bitbucket-upload-file), at #26's commits: two files, a missing one, a directory, whose listing is emptied, and the diffstat between the commits. Then the two-page diffstat between two releases of [atlassian/aui](https://bitbucket.org/atlassian/aui), with the first five files of each page and every renamed one kept. Bodies keep only the fields the adapter reads. |
| `unauthorized.synthetic.json` | A 401 for every method, shaped like the live 401 (empty `text/html` body). |
| `rate-limited.synthetic.json` | A 429 copied from one seen live on an anonymous request: `text/plain` body, `x-ratelimit-reset` in seconds, no `retry-after`. |

## API token scopes

Create a scoped Atlassian API token for Bitbucket with:

| Scope | For |
|---|---|
| `read:repository:bitbucket` | Files, commits, the merge base, the diff, the workspace's repositories, and who the user is, by their repository permissions in it |
| `read:pullrequest:bitbucket` | PRs, their commits and comments, and listing PRs |
| `write:pullrequest:bitbucket` | Posting comments, approving, requesting changes |

Scope names come from the `x-atlassian-oauth2-scopes` of each endpoint in Bitbucket's OpenAPI spec (`https://api.bitbucket.org/swagger.json`). The spec lists only the read scope for posting a PR comment; the write scope is listed here because approving needs it anyway.

`read:user:bitbucket` is needed only for `GET /user`, which is asked when no workspace says who the user is. The permissions endpoint's answers carry `x-accepted-oauth-scopes: account, repository`, but a token without `read:user:bitbucket` got a 200 from it (2026-11-25).

To re-record `read.json`:

```bash
BITBUCKET_EMAIL=you@example.com BITBUCKET_API_TOKEN=... node src/adapters/bitbucket/fixtures/record.ts https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/26
```

The repo is public, so any valid token works.

To re-record `harness.json`, from repos that are public too:

```bash
BITBUCKET_EMAIL=you@example.com BITBUCKET_API_TOKEN=... node src/adapters/bitbucket/fixtures/record-harness.ts
```
