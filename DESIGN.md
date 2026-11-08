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

> Review should stop being "read every changed line." It should become "approve the decisions and verify the behavior," with human attention spent according to risk.

## Principles

1. **Start from intent.** Open with what was asked (ticket, prompt, or agent-session summary) and a plain-language summary of what changed in behavior. The first question is "does this do what we wanted?"
2. **Sort every change by risk.**
   - *Mechanical:* moves, renames, formatting, generated files. Collapsed, with machine proof (e.g. "moved code verified identical").
   - *Logic:* ordinary code changes. Normal read.
   - *Contract:* public API, schema, permissions, dependencies, config, security boundaries. Where human attention goes.
3. **Guided tour.** Start at the entry point, follow the call graph, and group changes by concept so the review reads like a story, not a file tree.
4. **Review decisions, not lines.** Extract the decisions the code makes ("retries 3 times with no backoff", "adds dependency X", "stores token in localStorage") as a checklist to approve or reject. Comments attach to decisions.
5. **Evidence over code.** Show tests run and their coverage, before/after outputs, sample requests and responses, and UI screenshots.
6. **Machines go first.** AI and static tools look for bugs first. Humans see only the findings machines are confident about; nits are fixed automatically, never discussed.
7. **Ask the code.** The reviewer can ask questions ("what if `user` is null here?") and get answers grounded in the code, without checking out the branch.
8. **Close the loop with the agent.** A reviewer comment becomes an instruction to the agent; the reviewer re-reviews only the resulting delta against the decision they flagged.
9. **Depth matches risk.** Low-risk changes get auto-approved or a quick look; contract changes get a deep review. The tool picks the depth and says why.
10. **Review the plan before the code.** Approving an agent's plan is the cheapest review. Code review then becomes a conformance check against the approved plan.

## Decisions

- **Product form:** standalone web UI, served locally by a CLI, with no server of ours. See [ARCHITECTURE.md](ARCHITECTURE.md).
- **First slice:** take a GitHub or Bitbucket Cloud PR and produce a guided review: an intent summary, hunks sorted by risk with mechanical ones collapsed, and a list of extracted decisions. This covers principles 1–4, which the rest build on.
- **The model is optional.** Without it, the review is built by deterministic code: risk from rules that can only mark a change *contract*, a tour that follows the call graph with tests next to their code, and mechanical proofs as before. `--ai` adds intent and decisions on top, and titles the code's tour in plain language, without changing its steps. The page has to be good enough to review with before any model call, because each reviewer pays for their own, and a review that's useless without the model is one nobody runs until they've set up credentials. The model always on was the first version; with it, the page without credentials was an error.
- **Primary users:** both. A solo dev reviewing their own agent's output needs to *understand* it; a teammate reviewing someone else's PR needs to *trust* it. The same review has to serve both.
- **Intent sources:** intent is extracted, not entered by hand, from:
  - the PR description;
  - Jira tickets mentioned in the description, commits or branch name;
  - the code itself, inferred from what the change actually does.

  Stated intent (description, tickets) and intent inferred from the code are compared. A mismatch between them is a finding in itself: the change does something nobody asked for, or misses something that was asked. So the two are shown side by side only when they disagree. When they agree, one line says the change does what was asked, and the full list of behavior changes sits behind a toggle. Always showing both was the first version. It said the same intent twice and made the intent panel the biggest thing on the page.
