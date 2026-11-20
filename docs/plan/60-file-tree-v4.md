# Stage 60: The file tree after the v4 design

**Status:** Done (main)
**Depends on:** 36, 45, 50
**Owns:** `web/src/review/tree/`, the tree's and the file header's icon in `web/src/review/diff/file-path.tsx`, the rail's entries in `web/src/pages/review/ReviewPage.tsx`, the tree's tokens in `web/src/styles/globals.css` and their pairs in `scripts/check-contrast.mjs`, the vendored icons and their notice in `scripts/build.ts`, the tree's examples in `web/src/design-system/`, the design-system baselines, the tree's paragraphs in ARCHITECTURE.md

## Goal

Rebuild the rail's file tree as the `hunk-filetree-v4` design draws it, exactly: IntelliJ IDEA's file and folder icons, a file's status on its name, a filter for files with findings or risks, a dot and a ring for Claude's points, names shortened in the middle rather than rows wrapping, and the tree as one keyboard widget.

Read first: ARCHITECTURE.md's Map paragraph on the tree and its Design system section, ENGINEERING.md's UI rules, [36-tree-rail.md](36-tree-rail.md). The design is `gallery.html`, `option-in-context.html` and `icons.html` in the archive, with its prototype in `ft.js`, `ft.css` and `icons.js`, and its contrast table in `contrast.json`. Where this doc and the prototype differ, the prototype wins.

## What changes

| Element | Today | v4 |
|---|---|---|
| File icon | lucide shape by role, colored by language family; a file with a plus or minus for new or deleted | IDEA's icon for the file type, light or dark variant; a Java file the class icon, a Java test the class with IDEA's test mark, a deleted Java file `fileTypes/java` |
| Folder icon | lucide folder, open or closed | IDEA's `module` (a dotted module like `com.oracle.svm.core`), `package` (inside one's source tree) or `folder` |
| New, deleted | green name; red struck name; a file-plus or file-minus icon | the same names, the type's icon |
| Extension | as the name | muted, mixed with a new or deleted file's color at 55% |
| Renamed | `renamed` chip | normal ink; "was …" in the tooltip |
| Claude's points | icon and count per kind, decisions too | a 6 px dot in `severity-minor` for findings, its count above one; a 7 px ring in `risk-logic` for risks; no decisions |
| Threads | bubble and count | the same |
| Line counts | `+n −m` always, in the diff colors | zeros left out, tints mixed 72% toward `muted-foreground` |
| Filter | text, with a `/` key hint | text, no hint; "46 files" and All, Findings n, Risks n |
| A long name | the counts wrap under it | whole camel-case words cut from the middle, `Recurring…Support.java`, never the extension; rows never wrap |
| Directory heading | chevron down, folder, its path, a guide line, sticky | chevron right turning down, icon, muted path with its last directory in medium weight, a count when closed; no guide, not sticky |
| Directories | a chain is one heading; a directory of one file is no heading; the directory every file is in goes above the tree | a chain is one heading; a top directory with no files and more than one directory joins its children's labels; every directory is a heading |
| Java's repeated module path | shown | `com.x.core/src/com/x/core/` read as `com.x.core/` |
| Current file | `surface-row`, 3 px bar, medium | `diff-hunk-bg`, 2 px primary bar inset 4 px |
| Keyboard | a button per row, a Tab stop each | ARIA tree: one Tab stop, arrows, Home, End, ← and →, Enter and Space; ↑ from the first row to the filter, ↓ from the filter |
| Size | 24 px rows, 12 px indent | 28 px rows, 9 px indent, 13 px names, 12 px directories, 11 px mono counts |

The page orders its file cards by `byTreePath`, so the tree's order and the cards' stay one: `byTreePath` compares the paths as the tree shows them, with Java's repeated module path left out.

## Work

1. **Icons.** The SVGs the design uses, unmodified, in `web/src/review/tree/icons/` with `PROVENANCE.md` naming the intellij-community commit and each file's path. The archive's `LICENSE.txt` is JetBrains' open-source build terms, not the license the SVGs name, so the Apache-2.0 text goes beside them, and `scripts/build.ts` adds the icons to `THIRD_PARTY_LICENSES.txt`. Vite imports each as a URL. An icon is two `<img alt="">`, the dark variant shown under `.dark`, so a theme switch needs no render.
2. **Paths.** `paths.ts`: the Java module elision, the hoisting, every directory a heading, no common root above the tree; the folder kinds.
3. **Names.** A pure `shortenName(stem, fits)`, measured with a canvas in the rows' font, again when the rail's width changes and once fonts load.
4. **The tree.** `file-tree.tsx` as an ARIA tree with the filter row and the pills; the row as v4 draws it, its accessible name the prototype's sentence (name, type, status, lines added and removed, threads, finding, risk, directory).
5. **Tokens.** `--stat-add`, `--stat-del`, `--file-ext-add` and `--file-ext-del` as `color-mix` in `globals.css`, with their pairs on the row's three fills in `check:contrast`.
6. **Docs and checks.** ARCHITECTURE.md's tree paragraphs; the design-system page's examples and baselines; tests for the icons, the path rules, `shortenName`, the keyboard and the pills.

## Accepted from the design

ARCHITECTURE.md records these with the design as the reason:

- A new file is told from a modified one by its name's color alone on screen; its word is in the row's accessible name. In dark the green is 1.02:1 against the ink.
- A rename is said only in the tooltip and the accessible name.
- A finding's dot is `severity-minor` and a risk's ring `risk-logic`, not the red and amber the rest of the page uses.
- Headings don't stick, and a directory of one file is a heading again.

## Later

**Java's type kinds.** The design shows an interface's icon for an interface; the page doesn't know a file's kind. prep can record each Java and Kotlin file's top-level type on `FileChange` from tree-sitter, which is a contract change and a `PIPELINE_VERSION` bump: every cached PR is analyzed again and loses its AI run. Until then every Java file shows the class icon. Icons for the languages the design doesn't cover (CSS, HTML, Go, Rust and the others `languages.ts` names) come from the same commit when they're wanted; until then they're `unknown`.

## Definition of done

- [x] The icons vendored with their license and provenance, and in the package's notices
- [x] The tree as the table says, in both themes and the color-blind diff
- [x] New tokens with their pairs in `check:contrast`
- [x] Design-system baselines updated; `pnpm check` and `pnpm e2e` pass
- [x] Seen on `pnpm dev:fake` at 1440, 1024 and 375 px in both themes

## Notes for later stages

- A hovered row is `surface-row`, not v4's `accent`: in dark, a deleted file's red on `accent` was 4.43:1.
- `fileKind` maps a few extensions the prototype didn't (`jsx`, `mts`, `cts`, `cjs`, `pyi`, `jsonc`) to the icons it has; a test is marked only in Java, as v4 has it.
- With every directory a heading, the many-folder fixtures take 18, 20 and 22 headings for 24, 23 and 27 files, where the version before took 13, 9 and 22.
- A Java test is any file `isTestFile` says is one, not only a name ending in `Test.java`.
- Seen on `pnpm dev:fake` at 1440 px in light and dark and at 375 px; `pnpm e2e` passes, with the four `screens` baselines updated.
