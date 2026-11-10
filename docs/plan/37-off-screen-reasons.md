# Stage 37: Dividers say only what the code doesn't

**Status:** Done (on main, no PR)
**Depends on:** 36
**Owns:** The contract divider in `web/src/diff/HunkCard.tsx` and `web/src/pages/review/` (`HunkView.tsx`, `model.ts`), and `credentialCalls` in `src/domain/review/risk-rules.ts`

## Goal

A contract part's divider gave the rule's reason, and the reason quoted the code under it: "changes credential storage (save_account_token)" over `def save_account_token(`, "changes a credential endpoint (PUT /api/account-connections/{domain}/token)" over the decorator that says so. It told the reviewer which rule fired, which matters to the rules, not to the review. The one fact it held that the code didn't show was half said: `forget_saved_token` is called there but defined in another file, where the token is actually deleted.

## What changes

- A divider shows a rule's reason only when the code on screen doesn't show it:
  - a credential or authorization name the part **calls** and its file doesn't define: "Calls `forget_saved_token` in delphi_code/services/application.py: credential storage", the file from the call-graph hint, or "in another file" without one;
  - "removes tests", which is counted over the whole hunk, a net loss the deleted lines alone don't show.
- Dropped from the divider: names the part defines, credential endpoints, risky calls and skipped tests, all on the lines under it. The path rules' reasons stay on the file's header.
- The model's reasons stay: they explain, they don't quote.
- The bar beside the lines keeps the full reason as its tooltip and its text for screen readers, so why a part is red is still one hover away.

## Definition of done

- [x] `pnpm check` passes.
- [x] On delphi-code #2, the PUT route's part has no divider and the DELETE route's names where `forget_saved_token` is defined.
- [x] Tests cover a defined name (no divider), a called name (divider with its file), a removed test, and a model reason.
- [x] ARCHITECTURE.md says what a divider shows, with the alternative rejected (every rule's reason).

## Measurements

delphi-code #2 (`a_e4ebdbe1874e191f`, without `--ai`, with the checkout), checked live: 20 contract parts, 5 with a divider. The PUT route has none; the DELETE route's says `forget_saved_token` is in `delphi_code/services/application.py`. hosts.py's calls into keychain.py and remote_repositories.py's call of `save_token` in hosts.py are the other four.

## Notes for later stages

- **A name the file defines too isn't a call elsewhere.** remote_repositories.py defines `forget_saved_token` and calls hosts.py's of the same name; the divider says nothing, since the rule can't tell the two apart. The call-graph hint could: it links the call to the file it reaches.
- **Contract parts on a path rule alone** (openapi.json) have no part reason; the file's header gives it, and the bar's tooltip is empty.
