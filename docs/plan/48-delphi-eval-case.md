# Stage 48: delphi-code #2 as an eval case

**Status:** Not started
**Depends on:** 47
**Owns:** `evals/cases/delphi-account-connections/`, its entry in `evals/cases/index.ts`

## Read first

- [Stage 47](47-eval-noise-metrics.md): the label format this case uses (`"either"`, `riskAt`) and the metrics it feeds.
- [evals/README.md](../../evals/README.md), *Add a case*.
- `evals/cases/large-retry-after/`: the imported case to copy, with its `PROVENANCE.md`.
- ARCHITECTURE.md, Model passes: the risk and decisions rules the labels follow, and the delphi-code #2 numbers they were measured on.

## Goal

Every problem the risk and decisions prompts were changed for showed on [delphi-code #2](https://github.com/markdorofeev/delphi-code/pull/2) and on none of the eval cases: 25 risks where about 7 are worth a stop, risk bands on imports above the code they meant, and 6 of 8 decisions repeating the PR's description. The cases are small (most have 2 to 5 hunks), and noise needs room to show. This stage adds delphi-code #2 as a case, so stage 47's `riskNoise`, `riskPlaced` and `restates-description` have the PR they were made for.

It's a full-stack PR: 21 files, 48 hunks, +1269 −39. Python routes, services, host classes and a keychain module, a generated OpenAPI schema and TypeScript client, a React setup page, and tests. Its description explains most of its choices.

## Decisions

- **Imported at head `c07d2c5fd38f075a007c1f9dc38304ef8ffd4f4d`.** Every measurement in ARCHITECTURE.md and the labels below are at that commit, base `3d7d144060f40497d1cec36c904f7651857fcb1c`. The PR is still open, and `evals/import-pr.ts` takes whatever head it has. If the head has moved, stop and ask the user; don't import another commit.
- **Licensed for it.** delphi-code is public under Apache-2.0, and megareviewer is public under MIT. Apache-2.0 asks that a copy of its license go with the copied files, so the case directory holds delphi-code's `LICENSE` beside `PROVENANCE.md`, and its `NOTICE` if it has one.
- **Labels are ground truth, so every finding is checked in the code.** The candidates below come from three runs of the model; each is labeled only if the code at `c07d2c5` shows it, read from the case's own `files/head/`.

## Tasks

1. Import:

   ```bash
   GITHUB_TOKEN=$(gh auth token) node evals/import-pr.ts https://github.com/markdorofeev/delphi-code/pull/2 delphi-account-connections
   ```

   Check that `pull-request.json` has head `c07d2c5…` and base `3d7d144…`.
2. `PROVENANCE.md` as `large-retry-after`'s, with the import command, and delphi-code's `LICENSE` (and `NOTICE`, if any) copied beside it.
3. `case.ts` as `large-retry-after`'s. Its `tests` line: "A 48-hunk full-stack PR whose description explains its choices: risk noise on API models, a generated client and plumbing between the PR's own modules; risks on hunks that open with imports; decisions that repeat the description."
4. `labels.ts`, from `node evals/print-hunks.ts delphi-account-connections`, as below.
5. Register the case in `evals/cases/index.ts`, `source: "imported"`.
6. Run the free checks: `pnpm test` (stage 47's label checks pass on it) and `node evals/run.ts --case delphi-account-connections` without `--yes`, which prints the estimate. Record the estimate under **Notes for later stages**.

## Labels

Hunk IDs below are from megareviewer's analysis of the same commits. If `print-hunks` shows different IDs, the diff differs from the one measured: stop and ask.

### Risk

Every one of the 48 hunks gets a label. Contract, each with its `riskAt` on the new side:

| Hunk | File | Why contract | `riskAt` |
|---|---|---|---|
| `h_f0f06a5f0031f84f` | `http_api/routes/hosting_services.py` | New endpoints; PUT accepts a credential and persists it, DELETE removes one | The PUT route, 29–33, and the DELETE route, 36–38 |
| `h_cb05a3ceba6f0ebc` | `infrastructure/hosts.py` | `save_token` and `forget_saved_token` write and delete the user's secret | 79–84 |
| `h_458525b7a4806fe2` | `infrastructure/hosts.py` | Bitbucket clone now hands the saved token to git | 265–267 |
| `h_24393343afea5f06` | `infrastructure/hosts.py` | A saved token now outranks git-stored credentials for Bitbucket | 279–280 |
| `h_41ad920c36c36c34` | `infrastructure/hosts.py` | A saved token now outranks `gh` and git credentials for GitHub, and goes to git for clones | 340, 346 |
| `h_66f414f852d4bd40` | `infrastructure/keychain.py` | Runs `security` and `secret-tool` with the secret | 27–41 and 44–48 |

`"either"`, since the runs split on them and the rule doesn't settle them:

- `h_054a8a2424d85147`, `domain/hosting_services.py`: `AccountConnection.to_json()`, the response shape. Today only the PR's own page reads it, but it's an HTTP API.
- `h_79397fb1b9683b02`, `services/remote_repositories.py`: `connect_account`, which checks a token and saves it. It's the write path, but the persistence it reaches is in `hosts.py` and `keychain.py`.

Everything else is logic, including what the first prompt marked contract: the request and response models, the generated `openapi.json` and `web/src/api/schema.d.ts`, the router's registration in `app.py`, `ConnectionsSection.tsx`, the new methods in `services/application.py`, the network child's request names and output (both ends are in the PR), and the tests. Read each hunk before labeling it: a hunk this list doesn't name may still be contract by the rule, and one it names may not be. If you depart from this list, say why in a comment beside the label.

### Findings

Candidates, each to be confirmed in `files/head/` before it's labeled. Write its `at` from the lines that show it.

| Candidate | Where | Checked so far |
|---|---|---|
| A saved Bitbucket token that's rejected later shows the environment-variable hint, "set BITBUCKET_EMAIL", not "use another token" | `infrastructure/hosts.py`: the 401 branch near line 219 is unchanged, so it rests on hunk `h_c07602170366e828`, 187–198, where `_run_in_child_process` takes the credentials | Read in the code: true |
| With `BITBUCKET_APP_PASSWORD` set and no username or email, `clone_credentials` returns nothing while listing uses the saved token | `hosts.py` 263–272 against 274–286 | Read in the code: true |
| A saved token that `GITHUB_TOKEN` shadows still reads as a successful connect; the row says "Using the GITHUB_TOKEN…" but nothing says the new token is unused | `services/remote_repositories.py`, `connect_account` (hunk `h_79397fb1b9683b02`) | True; the page names the source, so it's minor |
| A saved GitHub token that's revoked comes before `gh` and git credentials, so working credentials behind it are never tried | `hosts.py` 343–353 | Not checked |
| A keychain command that fails reads as no saved token | `keychain.py` 22–23 | Not checked |
| Forget reports success when the keychain refuses the delete: `forget_secret` ignores the result | `keychain.py` 44–48 | Not checked |
| The tests read the real keychain, though the PR says they don't | `tests/test_sources.py`, hunk `h_d30f8b98357e61ae`, near line 260 | Not checked |

`mustHave` is true for a finding a reviewer would hold the merge for or certainly comment on; the rest are false. None of these is blocking; the revoked-token one, if it holds, is the strongest.

### Decisions

Expected, each `mustHave: false`, since each run found a different few:

- Why read the keychain entry back after saving it.
- Why the secret goes to `security -i` hex-encoded.
- Why the token page preselects the classic token with full `repo` scope, which grants more than listing needs.
- Why one failing service doesn't fail the whole list of connections.
- Why the keychain entry holds the token and the username as one JSON value.

Not expected, because the description says each with its reason and none has a consequence the reviewer must accept; the judge should rate them `restates-description` if they're produced:

- the secret passed on stdin, so it never shows in a process listing;
- saved tokens kept out of `git credential approve`;
- the account lookup run in the network child process;
- a token checked with the service before it's saved;
- Check again re-reading credentials without a restart.

### Mismatches

`[]`: in three runs the stated and inferred intent agreed.

## Not in this stage

- Running the paid evals on the case, and the baseline.
- Changing delphi-code, or labels of other cases.

## Definition of done

- [ ] The case is imported at `c07d2c5`, with `PROVENANCE.md` and delphi-code's license.
- [ ] Every hunk has a risk label, every contract hunk a `riskAt`, and every labeled finding was confirmed in the code.
- [ ] `pnpm check` passes, with the case's label checks.
- [ ] The cost estimate is recorded below.

## Open issues

None yet.

## Notes for later stages

None yet.
