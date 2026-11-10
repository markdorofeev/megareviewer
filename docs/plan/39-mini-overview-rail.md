# Stage 39: A miniature of the Overview as a second form of the rail

**Status:** Done (on main, no PR)
**Depends on:** 36
**Owns:** The rail's switch and its Overview form in `web/src/pages/review/` (`Rail.tsx`, `MiniOverview.tsx`, `mini-overview.ts`), the layout shared with the full Overview (`overview-layout.ts`), and the grouping depth in `overview.ts`

Asked for as stage 37; 37 and 38 were taken by the time it was picked up, so it takes the next free number.

## Goal

The tree shows where a file is, but not how the directories connect. The Overview shows that, but on another screen. With directories as boxes (stage 36) the Overview is small enough to stay beside the code, so the big picture and "where am I" can be one object.

It's an experiment against the tree, and the loser goes. Deterministic, no model calls, no pipeline change.

## Read first

- ARCHITECTURE.md, UI → Review page: the tree and the Overview
- Stage 36

## The switch

A `Tree · Overview` switch at the top of the rail, kept per browser, Tree by default. `v` still opens the full Overview.

## The Overview form

- **The miniature, pinned at the top of the rail.** The same boxes in the same rows and positions as the full Overview, from the same layout code, scaled to the rail's width. Edges are drawn the same way, thinner. A box's label is its directory's last segment, with parents where two boxes share one: `src/routes/` and `http_api/routes/` on delphi-code #2.
- The box holding the file in view is outlined, and moves as the reviewer scrolls. A click on a box scrolls the code to its first file; a box outside the PR scrolls to the code it uses.
- **Chips under it** for the directories outside the diagram (the full Overview's strip), with their file counts, clickable the same way.
- **Under the diagram, only:**
  - the files of the current directory, the directory of the file in view;
  - "Called by": files in other directories that call the file in view;
  - "Calls": files in other directories it calls.

  Rows look like the tree's rows. Rows in other directories add their directory, muted, since names repeat across directories.
- The miniature never opens a directory in place; that stays in the full Overview.

### When the diagram doesn't fit

The miniature is scaled, not reflowed, so a wide diagram gets small. It's legible while a box keeps at least a fifth of its full size (`MIN_SCALE`): 13px tall, one line of 10px text. At the rail's 264px that's a diagram at most 1320px wide.

Past that, directories group as the full Overview groups files outside the PR: by their leading directories. The miniature cuts every directory to its first *n* segments, from the deepest that fits down to one, and the rail says so: "Directories grouped to 2 levels to fit." The outline, the chips and the file list follow the grouped boxes. When no depth fits, it takes the narrowest diagram, which is the full one when grouping doesn't narrow it, as when the widest row is files outside the PR.

## Definition of done

- [x] `pnpm check` passes.
- [x] On delphi-code #2 the miniature shows the same boxes as the full Overview, and the outline follows the scroll.
- [x] Component tests cover the outline, the file list under the diagram and the chips.
- [x] ARCHITECTURE.md describes the switch as an experiment and what each form gives up: the tree, connections; the miniature, every file at a glance.

## What changed

- `overview-layout.ts` holds the overview's layout (`layout`, `nodeWidth`, `anchors`, `edgePath`, `edgeStyle`), moved out of `Overview.tsx` so the miniature draws from the same numbers.
- `fileOverview` takes a `depth` that cuts each file's directory to its leading segments (`boxDirectory`).
- `mini-overview.ts`: `fitMiniOverview` picks the depth, `miniLabels` the short labels, `miniLists` the files listed under the diagram. `MiniOverview.tsx` draws it: the full overview's boxes placed in percentages of its size, over an SVG of its edges with a `viewBox` at full size and strokes that don't scale.
- `Rail.tsx` holds the switch, stored as `rail-form`. The rail is an `aside` named Files; the tree is the `nav` inside it. `FileRow` and `relationOf` came out of `TreeRail.tsx`, so the miniature's rows are the tree's, with their directory added after the name.

## Measurements

delphi-code #2 (`a_1d8ef357c92cd8a8`, without `--ai`, with the checkout), checked live at 1440px: the full Overview is 1155px wide over seven rows, so the miniature draws it at 0.23, ungrouped, with the same 14 boxes: 10 directories and 4 files outside the PR. `tests/`, `web/` and `./` are chips. Scrolling from the top to `CONTRIBUTING.md`, the outline moved through `domain/`, `http_api/`, `infrastructure/`, `services/`, `picker/` and onto the `./` chip, and the directory under the diagram with it. On `routes/hosting_services.py`, "Called by" lists `app.py`, `test_http_api.py` and `ConnectionsSection.tsx`, and "Calls" the request and response models and `application.py`.

The first threshold, a quarter of full size at 256px, didn't fit delphi-code #2 and grouped it to one level: two boxes, `web/` and `delphi_code/`. Grouping didn't help either, since its widest row is `services/` beside three files outside the PR.

## Notes for later stages

- **Labels are cut in narrow boxes.** A box keeps its full width's share, set by the text the full Overview shows, so `http_api/routes/` at 62px reads `http_api/…`. The full label is in its tooltip and accessible name.
- **The outline needs the window to paint.** `useFileInView` follows the scroll on animation frames, which a hidden browser tab doesn't run; the live check swapped them for timers.
