# Engineering principles

How we write megareviewer. These apply to every change, whether a human or an agent makes it.

## 1. Practice what we preach

megareviewer exists to make code easy to review, so its own code has to be easy to review:

- A change is small and does one thing. Its PR states the intent and links the ticket.
- Formatting and lint are automated (Biome) and never discussed in review.
- Once megareviewer works, every PR to it gets reviewed in megareviewer.

## 2. Domain model

The core domain is turning a PR into something a human can review fast.

### Ubiquitous language

Code, UI and docs use these names, and only these names, for these concepts. A new concept is added here first.

| Term | Meaning |
|---|---|
| Pull request | A host-agnostic PR: title, description, branch, commits, diff, head SHA |
| Hunk | One contiguous change, identified by a stable hunk ID. Risk, proofs and decisions are per hunk; the page runs the risk rules on a split part's own lines |
| Part | The lines of a hunk that change one definition, identified by a part ID. A hunk that isn't split is one part. The tour and hints are per part |
| Risk class | *mechanical*, *logic* or *contract* |
| Mechanical proof | Deterministic evidence that a hunk is mechanical: generated, whitespace, rename, move or formatting |
| Intent | Stated intent (description, tickets), inferred intent (code), and the mismatches between them |
| Decision | A choice the code makes, resting on one or more hunks |
| Verdict | The reviewer's answer on a decision: pending, approved or rejected |
| Tour | Hunks ordered into steps, grouped by concept |
| Checkout | A local git clone of the PR's repository, read at the PR's head commit and never changed |
| Unchanged caller | Code outside the PR that calls a definition the PR changes, or names it as a type. Read from a checkout |
| Call site | A use, at a line and column of a part, of a definition the PR changes: where the page shows the code a call runs |
| Analysis | All of the above for one PR at one head SHA and pipeline version |
| Publication | The review sent back to the git host |
| Review thread | A conversation the host keeps on lines of a file: its comments, whether it's resolved or outdated. Read live, never part of an analysis |
| Severity | How much a comment matters: *minor*, *major* or *blocking*, carried in its body |
| Suggestion | The lines a comment proposes in place of the ones it's on |

### Bounded contexts

| Context | Kind | Contains |
|---|---|---|
| Review | Core | Analysis, hunks, risk, intent, decisions, tour, verdicts |
| Diff analysis | Supporting | Diff parsing, mechanical proofs, call-graph hints |
| Integrations | Generic | Git hosts, Jira, Claude, storage |

The core holds the rules. Integrations translate external data into domain terms and nothing more. GitHub's and Bitbucket's PR shapes never travel past their adapter.

## 3. Architecture: dependencies point inward

```
domain  ←  application  ←  adapters  ←  cli (composition root)
```

- **domain:** types and pure logic. No I/O, clock, randomness or framework. The one library it may import is Zod.
- **application:** use cases (`AnalyzePullRequest`, `RecordVerdict`, `PublishReview`) and the ports they need (`GitHost`, `TicketSource`, `AnalysisModel`, `AnalysisStore`, `CodeParser`, `Clock`, `Logger`).
- **adapters:** implementations of the ports (GitHub, Bitbucket, Jira, Claude, SQLite, tree-sitter), plus the HTTP API.
- **cli:** wires adapters into use cases. It is the only place that knows concrete implementations.
- **web:** talks to the server only through the HTTP API contract.

```
src/
  domain/
  application/
  adapters/{github,bitbucket,jira,claude,sqlite,treesitter,git,http}/
  cli/
contracts/   HTTP API schemas shared by server and web
web/
```

These rules are enforced by dependency-cruiser in CI, not by convention.

## 4. Boundaries

- **Each module has one public entry point** (`index.ts`). No deep imports across modules.
- **Parse at the edge.** Everything that comes from outside (host APIs, Jira, model output, HTTP requests, database rows) is parsed with Zod into domain types in the adapter. Inside, data is typed and trusted.
- **Model output is untrusted input,** the same as host data.
- **The HTTP API is a contract.** It's defined in `contracts/`, versioned, and the only coupling between web and server. It's also the seam for replacing the server (see [ARCHITECTURE.md](ARCHITECTURE.md)).

## 5. SOLID, applied

- **Single responsibility:** one reason to change per module. The GitHub adapter changes when GitHub's API changes, and for nothing else.
- **Open/closed:** adding a git host means adding an adapter. The pipeline and UI don't change.
- **Liskov substitution:** every adapter for a port passes the same contract test suite.
- **Interface segregation:** small ports shaped by what a use case needs, not one big `Integration` interface.
- **Dependency inversion:** use cases depend on ports. Only `cli` knows the adapters.

Don't over-apply it. An interface exists only at an I/O boundary or when there's a second implementation. Abstract on the third repetition, not the first.

## 6. Code

- TypeScript `strict` plus `noUncheckedIndexedAccess`. No `any`, no non-null `!`, and no `as` casts outside parsing.
- Names come from the ubiquitous language.
- Logic is pure functions. Side effects live at the edges.
- Data is immutable by default.
- Expected failures (PR not found, PR too large, missing credentials) are typed results. Exceptions are for bugs.
- Comments explain why, not what. No dead or commented-out code.
- **Fail safe toward the reviewer.** When the code is unsure, it shows the reviewer more, never less. A hunk is collapsed only with a mechanical proof. Data is never silently dropped or truncated.

### UI

- **Tokens only.** Colors, type, radius, shadows and durations come from `web/src/styles/globals.css` through Tailwind's utilities (`bg-diff-add-bg`, `text-risk-contract`, `text-ui`). No hex, `rgb()`, palette colors such as `bg-zinc-100`, or inline colors. A color that isn't there is added to the tokens, with its pairs in `pnpm check:contrast`, not to a component.
- **Primitives from `web/src/ui`.** shadcn/ui on Base UI, owned here; a change from upstream is marked `// hunk:`. No other component library.
- **Classes with `cn()`,** from `web/src/lib/utils.ts`, and `cva` for a component with more than two variants. Tailwind generates only the classes it finds whole, so a class chosen by a value is spelled out in a map.
- **Never color alone.** A risk, verdict, status or changed line also has a glyph or a word.
- **One keymap.** Every shortcut is in `web/src/lib/keymap.ts`, and hints come from it through `KeyHint`.
- **WCAG 2.2 AA** in light, dark and the color-blind diff: 4.5:1 text, 3:1 for what isn't text, a visible focus, 24 px targets.

## 7. Testing

| Level | Covers | How |
|---|---|---|
| Unit | Domain and application | Fast and pure. Fakes for ports, no mocks of our own code |
| Contract | Each adapter | Recorded real responses as fixtures. One shared suite per port that every implementation must pass |
| Integration | The pipeline end to end | Fake `GitHost` and `AnalysisModel` |
| UI | Diff view, review page | Component tests, plus a few Playwright end-to-end tests: open PR → give verdicts → publish, against a fake host |
| Evals | Quality of the model passes | A golden set of PRs, scored. Run when prompts or schemas change, not on every commit, because they cost money |

- Tests never touch the network or the real clock. Time and IDs are injected.
- Every bug fix starts with a test that fails without the fix.
- Coverage is a signal, not a goal. CI requires 90% branch coverage for `domain` and `application`. Adapters and UI are covered by contract and end-to-end tests instead of a number.
- Mechanical proofs get the strictest tests, including adversarial cases. A false "mechanical" hides code from the reviewer, which is the worst bug this product can have.

## 8. Dependencies

- Few, justified and pinned. A PR that adds a dependency says why the standard library and existing dependencies aren't enough.
- No dependencies with install scripts and no native modules (see the supply-chain trade-off in [ARCHITECTURE.md](ARCHITECTURE.md)).

## 9. Privacy

No telemetry unless the user opts in. "Your code never leaves your machine" has to stay true.

## 10. Write decisions down

A significant decision goes into DESIGN.md or ARCHITECTURE.md, with the reason and the alternatives rejected, in the same PR as the change it drives.
