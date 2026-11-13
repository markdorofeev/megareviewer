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
3. **Guided tour.** Start at the entry point and follow the call graph, so the review reads like a story, not a file tree.
4. **Review points, not lines.** Extract what the reviewer should look at — a finding ("retries a charge after it succeeded"), a risk, or a decision the code makes ("retries 3 times with no backoff", "adds dependency X") — as a ranked list on the code it rests on. Each point is raised as a comment or dismissed; saying nothing means it's fine.
5. **Evidence over code.** Show tests run and their coverage, before/after outputs, sample requests and responses, and UI screenshots.
6. **Machines go first.** AI and static tools look for bugs first. Humans see only the findings machines are confident about, as points on the code; nits are fixed automatically, never discussed.
7. **Ask the code.** The reviewer can ask questions ("what if `user` is null here?") and get answers grounded in the code, without checking out the branch.
8. **Close the loop with the agent.** A reviewer comment becomes an instruction to the agent; the reviewer re-reviews only the resulting delta against the decision they flagged.
9. **Depth matches risk.** Low-risk changes get auto-approved or a quick look; contract changes get a deep review. The tool picks the depth and says why.
10. **Review the plan before the code.** Approving an agent's plan is the cheapest review. Code review then becomes a conformance check against the approved plan.

## Decisions

- **Product form:** standalone web UI, served locally by a CLI, with no server of ours. See [ARCHITECTURE.md](ARCHITECTURE.md).
- **First slice:** take a GitHub or Bitbucket Cloud PR and produce a guided review: an intent summary, hunks sorted by risk with mechanical ones collapsed, and a list of extracted decisions. This covers principles 1–4, which the rest build on.
- **Files, read whole, in path order.** The page shows each changed file once, all its changes on one card, in path order as a directory tree lists them. The call graph's story is in the overview's diagram. The guided tour by steps was the first version: a file several flows run was cut into a piece per step, five pieces of hosts.py on delphi-code #2, and the reviewer had to put it back together. Call order came next and left the page with the elements built around it, when the page was cut back to its primitives.
- **Shared code is read once.** When several flows of a tour run the same changed code, it's read in a section of its own before them, and each flow points back to it instead of the first flow reading it all. Tests go with the code they exercise, and every changed part is still in the tour exactly once. Reading it in the first flow was the first version: on delphi-code #2 the first route's flow held half the PR, because the other two routes run the same connection and keychain code.
- **A call shows the code it runs, where it is.** Resting the pointer on a call into code the PR changes opens that code in a card under it, which stays while the pointer is on it. Files are in path order, so the code a call runs is usually elsewhere on the page, and following a call is how a reader checks what it does. Going to the code lost the reader's place, and chips under every call were noise.
- **The model is optional.** Without it, the review is built by deterministic code: risk from rules that can only mark a change *contract*, a tour that follows the call graph with tests next to their code, and mechanical proofs as before. Analyze with Claude, a button on the review, adds intent and its points to the analysis in front of the reviewer, and titles the code's tour in plain language, without changing its steps. The page has to be good enough to review with before any model call, because each reviewer pays for their own, and a review that's useless without the model is one nobody runs until they've set up credentials. The model always on was the first version; with it, the page without credentials was an error. A flag at startup, `--ai`, was the version before the button: the reviewer had to know it and restart to get the model, for every PR or none.
- **Primary users:** both. A solo dev reviewing their own agent's output needs to *understand* it; a teammate reviewing someone else's PR needs to *trust* it. The same review has to serve both.
- **Intent sources:** intent is extracted, not entered by hand, from:
  - the PR description;
  - Jira tickets mentioned in the description, commits or branch name;
  - the code itself, inferred from what the change actually does.

  Stated intent (description, tickets) and intent inferred from the code are compared. A mismatch between them is a finding in itself: the change does something nobody asked for, or misses something that was asked. So the two are shown side by side only when they disagree. When they agree, one line says the change does what was asked, and the full list of behavior changes sits behind a toggle. Always showing both was the first version. It said the same intent twice and made the intent panel the biggest thing on the page.

- **Each kind of point its own weight and place.** What the model returns is one ranked list: findings (what looks wrong), the risks it raised itself, then the decisions the code makes. A finding is a draft comment under the line it rests on, with Claude's severity and a suggested change when the fix is a few lines; the severity is Claude's and stays on its card, so the comment the reviewer adds, and every comment on the PR, carries none; Add to review saves it as the reviewer's draft, Edit opens it in the comment box first, and it posts with the review under their name. A risk is a band over the range it starts, with the reason the change reaches past the diff. A decision explains why the code does something, never asks for a change, and is a chip at the end of its line that opens a footnote; the reviewer can hide them all. Dismiss folds any of them. Silence means fine. Cards of one shape were the version before, first over each part and then under the last of their lines, and the reviewer couldn't tell what to stop on from what could be left alone, nor that three of the five said the same thing: the prompts now name the intent mismatch a finding shows, which then isn't a point of its own, and leave anything that looks wrong out of the decisions. Before that, approve and reject on each decision: seven clicks to say "fine", and one skipped silently turned an approval into a comment. Only a risk the model raised is a point, with its reason about behavior; a hunk a path rule marks contract stays a count in its file's header, since the rule read the path, not the code.

- **The reviewer picks the verdict when publishing:** comment (the default), approve or request changes. It no longer follows from counts of clicks, so Publish is offered on any complete analysis: an approval with nothing to say is a review in itself. Choosing was removed from the dialog once, when there was nothing to base it on without decisions; a raised finding is that base now. With silence meaning fine, the published review is the whole record of what the reviewer thought (see the fourth goal above).
