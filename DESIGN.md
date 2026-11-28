# Design

How code review should work now that most code is generated. See [MISSION.md](MISSION.md) for why.

## What review is for

1. **Catch defects:** bugs, security holes, regressions.
2. **Guard the design:** does this change belong here, and is it the right approach?
3. **Spread understanding:** at least one person besides the author knows how the system works now.
4. **Accountability:** a human signs off.

Generated code strains all four. There's far more code, the author often doesn't fully understand it, and the intent lives in a chat transcript nobody sees. Understanding suffers most: if nobody really reads the code, nobody understands the codebase.

## Why the diff view fails

The diff view was designed for a world where code was expensive and every line was written on purpose.

- Files are ordered alphabetically, so the reviewer has to rebuild the story.
- Every line gets equal weight: a lockfile bump looks as important as a removed auth check.
- It shows changed text, not changed behavior, so the reviewer simulates the program in their head.
- The intent is missing: what was asked and which alternatives were rejected.
- Comments attach to lines, but real concerns are about decisions.
- Nitpicks waste attention when code is cheap to regenerate.

## Thesis

> Review should stop being "read every changed line." It should become "understand the change, check what the machine found, and read the code where it matters."

## Principles

1. **Start from intent.** Open with what was asked (ticket, prompt, or agent-session summary) and a plain-language summary of what changed in behavior. The first question is "does this do what we wanted?"
2. **Sort every change by risk.**
   - *Mechanical:* moves, renames, formatting, generated files. Collapsed, with machine proof (e.g. "moved code verified identical").
   - *Logic:* ordinary code changes. Normal read.
   - *Contract:* public API, schema, permissions, dependencies, config, security boundaries. Where human attention goes.
3. **Guided tour.** Start at the entry point and follow the call graph, so the review reads like a story, not a file tree.
4. **Review points, not lines.** Extract what looks wrong, a finding ("retries a charge after it succeeded") or a difference between what was asked and what the code does, as a ranked list on the code it rests on. Each point is raised as a comment or dismissed; saying nothing means it's fine.
5. **Evidence over code.** Show tests run and their coverage, before/after outputs, sample requests and responses, and UI screenshots.
6. **Machines go first.** AI and static tools look for bugs first. Humans see only the findings machines are confident about, as points on the code; nits are fixed automatically, never discussed.
7. **Ask the code.** The reviewer can ask questions ("what if `user` is null here?") and get answers grounded in the code, without checking out the branch.
8. **Close the loop with the agent.** A reviewer comment becomes an instruction to the agent; the reviewer re-reviews only the resulting delta against the point they flagged.
9. **Depth matches risk.** Low-risk changes get auto-approved or a quick look; contract changes get a deep review. The tool picks the depth and says why.
10. **Review the plan before the code.** Approving an agent's plan is the cheapest review. Code review then becomes a conformance check against the approved plan.

## Decisions

- **Product form:** standalone web UI, served locally by a CLI, with no server of ours. See [ARCHITECTURE.md](ARCHITECTURE.md).
- **First slice:** take a GitHub or Bitbucket Cloud PR and produce a guided review: an intent summary, hunks sorted by risk with mechanical ones collapsed, and the points worth the reviewer's attention on the code. This covers principles 1–4, which the rest build on.
- **The model is optional.** Without it, the review is built by deterministic code: risk from rules that can only mark a change *contract*, flows that follow the call graph with tests next to their code, and mechanical proofs as before. Request AI review, a button on the review, adds intent and its points to the analysis in front of the reviewer. The page has to be good enough to review with before any model call, because each reviewer pays for their own, and a review that's useless without the model is one nobody runs until they've set up credentials. The model always on was the first version; with it, the page without credentials was an error. A flag at startup, `--ai`, was the version before the button: the reviewer had to know it and restart to get the model, for every PR or none. The model is the reviewer's choice, on the button: its menu lists every model megareviewer knows on every provider, the ones the machine can't run disabled with why and the fix, so a reviewer learns what signing in to another provider would add. Hiding them was the alternative. The last model used is remembered across restarts, so a reviewer who prefers another one picks it once. Sonnet 5.5 is the default, because on the evals it says far less that's wrong than Haiku for cents more a PR.
- **Primary users:** both. A solo dev reviewing their own agent's output needs to *understand* it; a teammate reviewing someone else's PR needs to *trust* it. The same review has to serve both.

The other decisions are in a file per part, under `docs/design/`. Read the one for what you're changing.

| File | Covers |
|---|---|
| [reading-the-code.md](docs/design/reading-the-code.md) | Files read whole in path order, shared code read once, calls that show their code, code outside the PR, and saying how much of the repository was read |
| [tour.md](docs/design/tour.md) | The tour: what it shows, why by what the change makes true, and its layout |
| [overview.md](docs/design/overview.md) | The overview: the flow paths' three forms, the data flow, and why it's off by default |
| [intent.md](docs/design/intent.md) | Where intent comes from, comparing stated and inferred intent, and why it's one line |
| [findings.md](docs/design/findings.md) | Points as findings, their types and severities, and why contract is the rules' alone |
| [preferences.md](docs/design/preferences.md) | The reviewer's preferences: what one is, where they come from, and how a point says which shaped it |
| [harness.md](docs/design/harness.md) | A repository's rules: the guideline files, what they link, and what's never rules |
| [guardrails.md](docs/design/guardrails.md) | Naming a check that would catch a finding, and how sure megareviewer is of it |
| [main-page.md](docs/design/main-page.md) | The PR picker: a field for a link, the PRs waiting, and the calendar of reviews |
| [publishing.md](docs/design/publishing.md) | The verdict, Approve, Revoke approval, and publishing more than one review |
