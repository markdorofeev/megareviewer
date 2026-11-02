# GitHub fixtures

Each JSON file is a list of exchanges in the format of `createFixtureFetch` (`src/application/testing/`).

| File | Source |
|---|---|
| `read.json` | Recorded with `record.ts` from [sindresorhus/is#210](https://github.com/sindresorhus/is/pull/210), a merged two-file PR, plus a missing file (read in the same GraphQL query as a changed one) and a missing PR in the same repo. Bodies keep only the fields the adapter reads. Names are replaced: the token owner's with `null`, commit authors' with their GitHub login. |
| `search.synthetic.json` | Written from GitHub's docs for `GET /search/issues`. Recording would capture the token owner's own PRs. |
| `publish.synthetic.json` | Written from GitHub's docs for creating a review and listing its comments, against #210's head SHA. Recording would post a real review. |
| `unauthorized.synthetic.json`, `rate-limited.synthetic.json` | Written from GitHub's docs: a 401 for every method, including the GraphQL file read, and a 403 with `x-ratelimit-remaining: 0`. |

To re-record `read.json`:

```bash
GITHUB_TOKEN=$(gh auth token) node src/adapters/github/fixtures/record.ts https://github.com/sindresorhus/is/pull/210
```
