# Stage 62: Code and file tree typography

**Status:** Done (main)
**Depends on:** 14, 60, 61
**Owns:** the fonts, type scale, diff and syntax tokens in `web/src/styles/globals.css` and their pairs in `scripts/check-contrast.mjs`, the roles in `web/src/review/diff/syntax.ts`, the diff line's and the tree row's type in `web/src/review/diff/diff-line.tsx` and `web/src/review/tree/file-tree.tsx`, the type and syntax samples in `web/src/design-system/`, the design-system baselines, the palette's and the fonts' paragraphs in ARCHITECTURE.md

## Goal

Set code and the file tree as the `hunk-code-type` design has them: JetBrains Mono at 13.5/22 for code, Inter at 13.5 in 30 px rows for the tree, and a syntax palette from IntelliJ's without green, red or amber, which mean added, removed and risk.

Read first: ARCHITECTURE.md's Design system section, ENGINEERING.md's UI rules. The design is `IMPLEMENTATION.md`, `tokens.css`, `shiki/`, `reference/` and `shots/` in the archive. Where the design and a decision in ARCHITECTURE.md differ, the decision wins, and the table below says where.

## What changes

| Element | Before | Now |
|---|---|---|
| Code | Geist Mono 13/20 | JetBrains Mono 13.5/22, weight 400, `liga` and `calt` off |
| Line numbers, hunk headers | 13 px | 12.5 px on the row's 22 px |
| + and − | semibold | regular |
| Code in comments, suggestions, unchanged callers | Geist Mono 12/18 | JetBrains Mono 12/18 |
| Tree names | Geist 13 px, weight 450 | Inter 13.5 px, weight 500 |
| Tree rows | 28 px, 9 px indent | 30 px at least, 14 px indent |
| Tree directories | 12 px | 12.5 px |
| Tree counts | Geist Mono 11 px | JetBrains Mono 12 px |
| A risk's ring in the tree | `risk-logic` | `risk-contract-solid` |
| Syntax | violet keywords, teal strings, blue functions, amber constants | blue keywords, teal strings, blue-green functions, blue numbers, purple decorators and attributes |
| Light diff tints | `#EAF7EE` and `#FDEEEE` lines, `#CCEFD7` and `#FADADA` words | `#EBF6E9` and `#FCEEED` lines, `#C3E5BD` and `#F4C9C6` words |
| Line numbers' and hunk headers' colors | `#71717A`, `#4338CA` in light | `#5E5E68`, `#2B3FA8` in light; `#9A9DA6`, `#AEB8FF` in dark |

## Kept from our decisions, where the design differs

- **Dark surfaces.** The design's dark is the near-black page ARCHITECTURE.md records as the first version. Its dark diff tints aren't taken, and its dark syntax hues are lifted in lightness to 4.5:1 on our added word, `#286142`, where as drawn they're 3.4:1.
- **Code's base text** stays `foreground`. The design's dimmer `#C9CBD1` in dark would be no brighter than a comment once comments pass on our tints.
- **Syntax colors are tokens on Shiki's CSS-variables theme.** The design's `hunk-light.json` and `hunk-dark.json` are a theme of our own for every language, with their own hex values. Its two new roles are mapped on top instead.
- **A hunk's side is highlighted alone**, from the state its first line is in. The design tokenizes whole files.
- **The tree** keeps its v4 structure, IDEA's folder icons and names cut by whole words; the design draws nested folders with lucide icons and cuts at 55% of the stem.
- **A line's number keeps its line's color.** The design's grey is 3.29:1 on our dark added gutter.
- **A changed word's radius** is the 4 px token; the design has 2 px.
- **The header, the bar and a file card's path** keep Geist and Geist Mono, as the design says.

## Changed in ARCHITECTURE.md

- Java's annotations took the constant color; they take the new decorator color. The constant color is the design's number blue, beside the keywords' blue.
- Receivers, declared constants and built-in types are plain in every language, not only Java, for the same reason. This recolors TypeScript, Python and the rest on that one rule.

## Not done

- **Preloading the two fonts.** Their files' names are hashed at build.
- **Card text at 13/19.** Cards are `text-ui`, 13/20, with the rest of the chrome.
- **`prefers-contrast: more`**, which the design marks optional.

## Definition of done

- [x] Fonts from pinned fontsource packages, their licenses in the package's notices
- [x] Tokens, with every syntax color on the page and on every line and word tint in `check:contrast`
- [x] Tests for the two new roles and for plain receivers
- [x] ARCHITECTURE.md's palette and fonts paragraphs
- [x] Seen on `pnpm dev:web:mock` in light and dark; computed fonts, sizes and row heights read from the page
- [x] Design-system baselines updated; `pnpm check` and `pnpm e2e` pass

## Notes for later stages

- A decision's chip sits from its line's top with a pixel over it. Aligned to the middle, as it was, it made its 22 px line 22.29 px in JetBrains Mono, whose x-height is taller.
- All sixteen design-system baselines are new, the main page's and the preferences' too, though nothing in them changed: the sections above them changed height by a fraction of a pixel, and a section is captured where it sits.
- `document.fonts` on the review page shows the four faces loaded, each from its Latin subset alone.
