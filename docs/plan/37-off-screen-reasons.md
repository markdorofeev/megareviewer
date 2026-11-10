# Stage 37: No reasons on a part's divider

**Status:** Done (on main, no PR)
**Depends on:** 36
**Owns:** The contract divider in `web/src/diff/HunkCard.tsx` and `web/src/pages/review/` (`HunkView.tsx`, `model.ts`), and `credentialCalls` in `src/domain/review/risk-rules.ts`

## Goal

A contract part's divider gave the rule's reason, and the reason quoted the code under it: "changes credential storage (save_account_token)" over `def save_account_token(`, "changes a credential endpoint (PUT /api/account-connections/{domain}/token)" over the decorator that says so. It told the reviewer which rule fired, which matters to the rules, not to the review. The one fact it held that the code didn't show was half said: `forget_saved_token` is called there but defined in another file, where the token is actually deleted.

## What changed

First, the divider kept only what the code on screen didn't show: a credential name the part calls and its file doesn't define, with the file that does ("Calls forget_saved_token in delphi_code/services/application.py, which handles credential storage"), "removes tests", and the model's reason. On delphi-code #2, 5 of the 20 contract parts kept one. Read live, it was still meaningless: the call is on the line, and "handles credential storage" was a guess from the name. So:

- A contract part has no divider for its reason, rule's or model's. Its risk is the bar beside its lines, without a tooltip; screen readers hear "contract".
- A divider is left only for a mechanical proof or uses outside the PR.
- The file's header keeps the path rules' reasons and the count of contract parts.
- `partReason` and the first version's `dividerNote` and `credentialCalls` are gone.

## Definition of done

- [x] `pnpm check` passes.
- [x] On delphi-code #2, no contract part has a reason on its divider; the bars still mark the 20.
- [x] ARCHITECTURE.md says what a divider shows, with the versions rejected.
