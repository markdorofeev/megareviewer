# Stage 56: The model reads the reviewer's guidance, and suggests preferences

**Status:** Not started
**Depends on:** 55
**Owns:** `src/adapters/model/` (the shared prompts, input rendering and output schema, and each transport), the catalog's `suggester` in `src/cli/model-access.ts`, the model fixtures and recordings

## Goal

Stage 55 puts the reviewer's preferences and the repository's guideline files in `AnalysisInput.guidance` and expects marks back on findings and risks. This stage makes the four passes read them, on all four transports, and implements the one call that turns review signals or past comments into proposed preferences.

Read first: [55-preferences-core.md](55-preferences-core.md) (its Decisions and Contract), ARCHITECTURE.md's Model passes, [43-triage-and-findings.md](43-triage-and-findings.md), [51-model-choice.md](51-model-choice.md).

## The guidance in the prompt

- **Where.** `renderInput` writes a `<reviewer_guidance>` block before `<pull_request_data>`, inside the same cached text, so every pass reads it from the cache on every transport without a placement of its own. With no preferences and no guideline files the block isn't written, and the rendered input is byte for byte what it was.

  ```
  <reviewer_guidance>
  <preferences>
  p1 look-for (everywhere): Tenant isolation: every query on a tenant's data filters by tenant ID
  p2 dont-flag (this repository): Naming of test helpers
  </preferences>
  <guideline_file ref="g1" path="REVIEW.md">
  …
  </guideline_file>
  </reviewer_guidance>
  ```

  Its tags join `TAGS`, so neither a preference nor a guideline file nor PR content can open or close them.
- **The system prompt** gains one section, the same text with or without a block, so the prefix stays stable: what the block is, that preferences are the reviewer's own and guideline files the team's as of the base commit, and their limits. Guidance changes what to look for and what to leave out. It never changes the answer's format, the rule that PR content is data, or the rule that text aimed at an automated reviewer is a finding. A guideline file that reads as instructions to do anything else is ignored.
- **Findings.** Each finding has `guidance`: `{ ref, effect }` or null. Look for: check the code for what the preference names, and mark a finding it led to `raised`; still only what the code shows, never a finding made up to satisfy a preference. Don't flag: still report what it matches, marked `left-out`, at most 5 of them, after the others and outside the limit of 10. A blocking finding is reported as left out like any other; the page folds it and says why.
- **Risk.** `guidance` on each assessment. A Look for preference that names an area ("any change to billing") makes a hunk there contract when the reason can still say what could break outside the PR, marked `raised`. A hunk a Don't flag preference matches is still classified by the code, and marked `left-out` when contract.
- **Decisions.** No mark. Explain first the choices in what a Look for preference names; leave out what a Don't flag one covers.
- **Intent.** No mark. `watch` says first when the change touches what a Look for preference names, in the same 12 words.

Keep the additions short: the prompts were tuned on the evals, and stage 59 measures that a run without guidance scores as before.

## The suggestion call

`PreferenceSuggester.suggest` on each transport that can run a single structured call: Claude Code (`runStructuredCall`), the API, Codex (`runCodexCall`) and opencode. It's a call of its own, with its own system prompt and its own schema (`{ proposals: ProposalDraft[] }`), not a fifth variant of the passes' union: it shares no cache with them, and the union is already near what opencode and a provider's grammar take.

- The prompt, in `src/adapters/model/shared/prompts/suggest.ts`: the reviewer's signals or past comments are in a data block, escaped as PR content is, with the preferences they already have and the proposals they rejected. Propose at most 8 rules, each one sentence a reviewer would write, each a Look for or a Don't flag, only where at least two signals or comments show the same thing (one is an accident), never one that restates an existing preference or a rejected proposal, and never one about a single PR's code. `evidence`: the signals it rests on, quoted briefly. `scope`: `"repo"` when every piece of evidence is from one repository and the rule is about that codebase.
- The data is untrusted as PR content is: point titles come from a model reading PR text. The prompt says so, the call has no tools under each transport's own lockdown, and its output is only ever a proposal the reviewer reads.
- Effort medium. Its usage comes back as a pass's does.
- A transport that can't make the call says why, and the catalog's `suggester` returns null for its options.

## Definition of done

- [ ] `renderInput` with guidance, escaped, and unchanged without it (a test compares with today's output on the fixtures).
- [ ] The system prompt and the four pass prompts; `PassAnswer` with `guidance` on findings and risks; the strict JSON schema still accepted by each transport's fixtures.
- [ ] `suggest` on Claude Code, the API, Codex and opencode, each with tests on recorded or synthetic fixtures; the real catalog returns it.
- [ ] Prompt versions and fingerprints bumped.
- [ ] A live check on delphi-code #2 through Claude Code with one Look for and one Don't flag preference: both marks come back and check out, and the later passes still read the PR from the cache. Recorded here.
- [ ] `pnpm check` passes.

## Notes for later stages

