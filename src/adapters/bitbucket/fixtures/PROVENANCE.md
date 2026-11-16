# Bitbucket fixtures

Each JSON file is a list of exchanges in the format of `createFixtureFetch` (`src/application/testing/`).

| File | Source |
|---|---|
| `read.json` | Recorded with `record.ts` from [atlassian/bitbucket-upload-file#26](https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/26), a merged five-file PR in a public repo, plus a missing file and a missing PR in the same repo. Bodies keep only the fields the adapter reads. Display names are replaced with `user-<uuid prefix>`, git authors' names and emails with the same pseudonym, and `…-by:` trailers in commit messages with `someone`. |
| `list.synthetic.json` | Written from Bitbucket's API docs: `GET /user`, the workspace's repositories, the reviewer query per repository, and the workspace's PRs by author, for a made-up `acme` workspace. Recording would capture the token owner's account and workspace. |
| `publish.synthetic.json` | Written from Bitbucket's API docs for creating PR comments and requesting changes, against #26's diff. Recording would post real comments. |
| `resolved-threads.json` | Recorded from [atlassian/trigger-pipeline#56](https://bitbucket.org/atlassian/trigger-pipeline/pull-requests/56), a public PR with four resolved threads, one resolved by someone other than its author. The comments list twice: with `fields` asking for `resolution.user` and `resolution.created_on`, as the adapter asks, and without, where every resolution is `{}`. Bodies keep only the fields the adapter reads; names and account IDs are replaced with `user-<uuid prefix>` and `account-<uuid prefix>`, and comment text with `Comment N.` |
| `unauthorized.synthetic.json` | A 401 for every method, shaped like the live 401 (empty `text/html` body). |
| `rate-limited.synthetic.json` | A 429 copied from one seen live on an anonymous request: `text/plain` body, `x-ratelimit-reset` in seconds, no `retry-after`. |

## API token scopes

Create a scoped Atlassian API token for Bitbucket with:

| Scope | For |
|---|---|
| `read:user:bitbucket` | `GET /user`, the current user |
| `read:repository:bitbucket` | Files, commits, the merge base, the diff, the workspace's repositories |
| `read:pullrequest:bitbucket` | PRs, their commits, and listing PRs |
| `write:pullrequest:bitbucket` | Posting comments, approving, requesting changes |

Scope names come from the `x-atlassian-oauth2-scopes` of each endpoint in Bitbucket's OpenAPI spec (`https://api.bitbucket.org/swagger.json`). The spec lists only the read scope for posting a PR comment; the write scope is listed here because approving needs it anyway.

To re-record `read.json`:

```bash
BITBUCKET_EMAIL=you@example.com BITBUCKET_API_TOKEN=... node src/adapters/bitbucket/fixtures/record.ts https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/26
```

The repo is public, so any valid token works; `read:user` isn't needed to record.
