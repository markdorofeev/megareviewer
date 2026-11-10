# Stage 38: Contract from path rules only

**Status:** Done (on main, no PR)
**Depends on:** 37
**Owns:** `src/domain/review/risk-rules.ts` and its tests, `PIPELINE_VERSION`

## Goal

Without the model, a change was contract when a path rule or a line rule matched. The line rules read the shape of names and text: credential storage (a storage verb and a credential noun in a name), authorization (permission words in a name), credential endpoints (a changing route with a `token`-like segment), risky calls (regexes on added lines), and removed or skipped tests (counts of declarations and skip markers). Probed with real counterexamples, every one of them failed both ways:

| Rule | Marked contract, shouldn't be | Missed |
|---|---|---|
| Credential storage | a lexer's `clear_tokens()` | `localStorage.setItem("token", token)`, `put_secret_value(…)`, `self._token = token` |
| Authorization | `Notification.requestPermission()` | a removed owner check, a removed `@login_required`, `Depends(require_same_origin)` dropped from a router |
| Credential endpoint | `POST /llm/tokens` that counts tokens | `POST /login`, `PUT /users/{id}/role` |
| Risky call | `"subprocess finished"` in a log, `eval()` in a comment, `innerHTML` in a test | `spawn("sh", ["-c", cmd])` after a destructured require, `pickle.loads`, `yaml.load` |
| Removes tests | two tests merged into one | a test's assertion deleted, `toBe(403)` weakened to `toBeDefined()` |
| Skips tests | a new `it.todo` | `@unittest.skip`, `pytest.skip()` in the body |

The misses are the changes contract exists for. Risk is about behavior (what a check guards, what a response exposes, what an assertion still proves), and the shape of a name doesn't tell it; longer word lists only move the edges.

## What changes

- The line rules go: credential storage, authorization, credential endpoints, risky calls, removed tests, skipped tests.
- The path rules stay, since they're facts about what a file is: dependencies, schemas and migrations, CI and infrastructure, repository config, app config, and auth or security paths, which still skip test code and hunks whose every line is inert.
- Behavior-level risk is the model's, with `--ai`; the rules still raise its answer, never lower it.
- `PIPELINE_VERSION` goes to 15, so cached analyses classify again.

## Definition of done

- [x] `pnpm check` passes.
- [x] delphi-code #2 measured before and after.
- [x] ARCHITECTURE.md describes the rules left, with the line rules as the alternative rejected and why.

## Measurements

delphi-code #2 (`a_e4ebdbe1874e191f`, without `--ai`, with the checkout): 10 contract hunks before, in routes/hosting_services.py, hosts.py (4), keychain.py, application.py, remote_repositories.py and openapi.json (2). After: 3, keychain.py on its security path and openapi.json's two. The token routes and hosts.py's token methods are logic now.

## Notes for later stages

- **Without the model, the token code isn't red.** That's the honest answer the rules can give: they can't tell what the code does. If a reviewer needs it marked without `--ai`, it has to come from something that knows behavior, not from more words.
- **`ruleReasons` lost its `whole` argument,** which only the removed-tests rule used.
- `PIPELINE_VERSION` is 15, and the small-feature fixture's key with it.
