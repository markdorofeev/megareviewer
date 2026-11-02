# Stage 18: Rule-based risk

**Status:** Done (pushed to main without a PR: 4b84610, 113752f)
**Depends on:** —
**Unblocks:** 19, 20, 21
**Owns:** `src/domain/review/risk-rules.ts` and its tests

## Goal

Classify every hunk without a mechanical proof as *contract* or *logic* with deterministic rules, so the review page can sort and weight hunks by risk without the model.

Rules only ever raise a hunk to *contract*. A hunk no rule matches is *logic*, shown in full. A wrong *contract* costs the reviewer a closer look; it never hides code (ENGINEERING.md §6). Rules never touch mechanical hunks: a proof decides those.

## Read first

- [DESIGN.md](../../DESIGN.md) principle 2: what counts as *contract*
- [ENGINEERING.md](../../ENGINEERING.md) §6 "Fail safe toward the reviewer"
- `src/domain/review/risk.ts`, `src/domain/diff/types.ts`

## Contract change

`RiskAssessment.source` gains `"rule"`, for an assessment made by these rules. A separate PR, with a line in stage 02's **Change log**. Nothing reads `source` yet besides the type.

## Tasks

### `classifyByRules(files, mechanicalHunkIds): RiskAssessment[]`

One assessment per hunk not in `mechanicalHunkIds`, in file and hunk order, with `source: "rule"`. A hunk that matches rules is *contract*, and its reason names every rule it matched, joined by "; " ("auth or security path; adds eval("). A hunk that matches none is *logic* with the reason `No contract rule matched.`

Path rules apply to every hunk of the file. Line rules look at the hunk's added lines, or its deleted lines where the rule says so.

| Rule | Matches | Reason |
|---|---|---|
| Dependency manifest | Basename `package.json`, `pnpm-workspace.yaml`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `Pipfile`, `Gemfile`, `composer.json`, `Podfile`, `pubspec.yaml`, `mix.exs`, `flake.nix`, `build.gradle`, `build.gradle.kts`, `pom.xml`, `requirements*.txt`, `*.csproj` | changes dependencies ({basename}) |
| Schema | Extension `.sql`, `.prisma`, `.proto`, `.graphql`, `.gql`, `.avsc`; a path segment `migrations` or `migrate`; basename starting with `openapi` or `swagger` | changes a schema or migration |
| CI and infrastructure | Under `.github/workflows/`, `.circleci/`; basename `.gitlab-ci.yml`, `bitbucket-pipelines.yml`, `Jenkinsfile`, `Dockerfile*`, `docker-compose*`, `compose.y*ml`; extension `.tf`, `.tfvars` | changes CI or infrastructure |
| Repository config | Basename `.env*`, `.npmrc`, `.yarnrc*`, `CODEOWNERS`, `.gitattributes`, `tsconfig*.json` | changes repository config ({basename}) |
| App config | Extension `.yaml`, `.yml`, `.json`, `.toml`, `.ini`, `.properties`, `.conf`, `.cfg`, under a `config`, `configs`, `conf` or `settings` directory or named `config.*`, `settings.*` or `application.*` | changes app config ({basename}) |
| Security path | A path word (split on non-alphanumerics and camelCase, lowercased) in: admin, auth, authn, authz, authentication, authorization, oauth, session, sessions, token, tokens, jwt, permission, permissions, acl, rbac, crypto, secret, secrets, password, passwords, credential, credentials, security, csrf, cors, login, saml, sso | auth or security path |
| Dangerous call (added lines) | `eval(`, `new Function(`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write(`, `dangerouslySetInnerHTML`, `child_process`, `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED`, `verify=False`, `InsecureSkipVerify`, `--no-verify` | adds {what it matched} |
| Removed tests | A deleted test file; or a hunk in a test file that deletes more test declarations (`it(`, `test(`, `describe(`, `def test_`, `func Test`, `@Test`) than it adds, so renaming a test doesn't count | removes tests |
| Skipped tests (added lines in a test file) | `it.skip(`, `it.only(`, `it.todo(` and the same on `test` and `describe`; `xit(`, `fit(`, `xdescribe(`; `@Disabled`, `@Ignore`, `@pytest.mark.skip`, `t.Skip(` | skips tests |

A test file is one whose basename matches `*.test.*`, `*.spec.*`, `*_test.*`, `*_spec.*`, `test_*.py`, `*Test.java`, `*Tests.java` (and `.kt`), or that sits under a `__tests__`, `test`, `tests` or `spec` directory. `.only(` counts as skipping, because it skips every other test in the file.

A renamed file is matched by both its old and its new path, so moving a file out of `auth/` still counts.

### Exports

`classifyByRules` and `isTestFile` from `src/domain/review/index.ts`. Stage 19 pairs tests with their subjects using `isTestFile`.

## How later stages use it

Stage 20 runs it after prep, always. When the model's risk pass also runs, a hunk is *contract* if either says so; the reasons from both are kept. Stage 21 shows the reason inline on contract hunks.

## Tests

- Each rule, by a minimal hunk that matches it and one that nearly does: `authors.ts` isn't a security path, `package.json.bak` isn't a manifest, `evaluate(` isn't `eval(`.
- Hunks in `mechanicalHunkIds` get no assessment, even in a file a path rule matches.
- A hunk matching several rules lists every reason once, in table order.
- A rename out of a security path is *contract*.
- Deleted test declarations count; added ones don't. A skip in a deleted line doesn't count.
- Adversarial: rules never produce *mechanical*, and every non-mechanical hunk gets exactly one assessment, over random file sets.

## Definition of done

- [x] Contract change in its own commit (4b84610), change log line in stage 02.
- [x] `classifyByRules` with the rules above, exported.
- [x] Tests above; 90% branch coverage holds.

## Open issues

- **Public API changes aren't detected.** A changed exported signature is *contract*, but finding one needs tree-sitter's symbols, which the domain doesn't have at this point. A later stage can add it as a rule fed by prep.

## Notes for later stages

_None yet._
