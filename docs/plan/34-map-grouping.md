# Stage 34: Grouping the map's files

**Status:** Done (on main, no PR)
**Depends on:** 33
**Owns:** `web/src/pages/review/grouping.ts`, `MapGuide.tsx`, the sections in `model.ts`, section headers in `MapLayout.tsx` and `RiskRail.tsx`, the toolbar in `ReviewPage.tsx`, and choices in `shortcuts.ts`

## Goal

An experiment to compare against call order. The map shows each file once in the call graph's order, which tells the story, but the reviewer also needs the riskiest code first, related code together and the big picture. Add a grouping by folder behind a switch, plus a list of the contract parts. Deterministic, no model calls.

## Read first

- ARCHITECTURE.md, UI → Review page → Map, which describes the grouping rules
- Stage 33

## What changed

- **A switch,** Calls · Folders, beside the jump field, kept per browser (`map-grouping`). Calls is the map as before: one section, no header.
- **`grouping.ts`:** `byCalls` and `byFolders`, both pure.
- **Sections with headers.** `MapSection` has a key, a title and a detail again. `mapSections` takes a grouping function over `mapFiles`, the files with a part to review in call order, so every grouping places the same parts. The rail heads its files with the section titles.
- **The calls in the code are planned over the whole map as one list,** so sections don't each open their first calls in place again.
- **The contract index** above the map: one row per contract part, six shown, then "N more".
- **Shortcuts work from a checkbox or radio button.** The switch is radio buttons, which had swallowed `n` and `j` after a click; the contract filter's checkbox did the same.

## Dropped: layers

A third grouping, by layer (web UI, API, services, domain, infrastructure, tests, config and docs), was built and dropped. A layer was a guess from path names. It read as expected on delphi-code #2, which is laid out by layer, but needed names only that repository uses (`keychain`, `hosts`), would put a repository laid out by feature mostly in Other, and needed callers-first ordering over the overview's links to avoid opening on the app factory and its test. ARCHITECTURE.md records why. A stored `layers` choice reads as call order.

## Dropped: the strip

A strip pinned above the code had a dot per changed file, colored by its highest risk, with a ring on the file the reviewer was on. Its columns were layers; without them it was a row of dots in page order, which said nothing the rail doesn't, so it went too.

## Fewer false contract parts

Reading the contract index on delphi-code #2 showed 30 contract parts, about a third of them noise. `risk-rules.ts`, owned by stage 18, changed with it, and `PIPELINE_VERSION` went to 13, then 14:

- Credential names count where they're defined, and as calls only from a file that doesn't define them.
- Tests and test helpers (fake, mock, stub, fixture) get neither the credential rules nor the security-path rule.
- Imports aren't risky calls.
- A split part's "removes tests" is counted over its whole hunk; `ruleReasons` takes the whole hunk, and the page passes it.
- A security path alone doesn't make a change contract when every changed line is inert: blank, comments, imports, strings, UPPER_CASE constants set to literals, closing brackets, and in markup, plain tags and text. `PIPELINE_VERSION` went to 14.

Result: 20 contract parts in 10 hunks, from 30 in 15. Gone: `fakes.py`, three `test_picker.py` tests (one a rename flagged as a removal), `fake_keychain.py`, two hosts.py parts that only call `_saved_token` and `_authorization_for`, keychain.py's two parts of constants, and the credentials guide's copy.

## Measurements

delphi-code #2 (`a_e4ebdbe1874e191f`, pipeline 14, without `--ai`, with the checkout): 21 files, 20 contract parts in 6. Folders give 12 sections, from `delphi_code/http_api/routes` to the top level.

## Notes for later stages

- **Pick one.** Compare Calls and Folders on real reviews; the one that loses goes, with the reason in ARCHITECTURE.md.
- **The index counts parts, the rail's totals hunks:** 20 contract parts against 10 contract hunks on delphi-code #2.
- **The inert lines are a list of patterns.** A line they don't recognize keeps a security path contract, so a new kind of inert line only costs attention.
