import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { FileChange, MechanicalProof } from "../../../../src/domain/diff/index.ts";
import type { RiskAssessment } from "../../../../src/domain/review/index.ts";
import { mechanicalRows } from "./mechanical.ts";
import { FileNotices, MechanicalGroup } from "./mechanical-group.tsx";
import { type Highlighter, HighlighterContext } from "./syntax.ts";
import { firstHunk, modifiedFile, parseFiles } from "./testing.ts";

const pendingHighlighter: Highlighter = { highlight: () => new Promise(() => {}) };
const wrapper = ({ children }: { readonly children: ReactNode }) => (
  <HighlighterContext.Provider value={pendingHighlighter}>{children}</HighlighterContext.Provider>
);

const lockfile = modifiedFile("pnpm-lock.yaml", [
  "@@ -1,1 +1,701 @@",
  " lockfileVersion: '9.0'",
  ...Array.from({ length: 700 }, (_, i) => `+  /pkg-${i}@1.0.0: {}`),
]);
const strings = modifiedFile("src/strings.ts", [
  "@@ -3,2 +3,2 @@",
  " export const trim = (text: string) =>",
  "-  text.trim();  ",
  "+  text.trim();",
]);
const [renamed] = parseFiles([
  "diff --git a/docs/setup.md b/docs/getting-started.md",
  "similarity index 100%",
  "rename from docs/setup.md",
  "rename to docs/getting-started.md",
]);
if (renamed === undefined) throw new Error("no rename");
const files: readonly FileChange[] = [lockfile, strings, renamed];

const proof = (
  file: FileChange,
  kind: MechanicalProof["kind"],
  detail: string,
): MechanicalProof => ({
  path: file.path,
  hunkId: file.hunks[0]?.id ?? null,
  kind,
  detail,
});
const proofs: readonly MechanicalProof[] = [
  proof(renamed, "rename", "renamed from docs/setup.md, content unchanged"),
  proof(strings, "whitespace", "whitespace only: trailing whitespace"),
  proof(lockfile, "generated", "lockfile (pnpm-lock.yaml)"),
];
const risk: readonly RiskAssessment[] = proofs.flatMap((each) =>
  each.hunkId === null
    ? []
    : [{ hunkId: each.hunkId, riskClass: "mechanical", reason: each.detail, source: "proof" }],
);

const renderGroup = (groupProofs = proofs) =>
  render(<MechanicalGroup files={files} proofs={groupProofs} risk={risk} />, { wrapper });

const LOCKFILE_ROW = "pnpm-lock.yaml — lockfile (pnpm-lock.yaml) (+700 −0)";
const STRINGS_ROW = "src/strings.ts — whitespace only: trailing whitespace (+1 −1)";
const RENAME_ROW = "docs/setup.md → docs/getting-started.md — renamed, content unchanged";

/** A row's text without its toggle's ▾, which is decoration. */
const text = (element: Element) => element.textContent?.replace("▾", "");

describe("mechanicalRows", () => {
  it("orders rows by file and hunk, whatever the order of the proofs", () => {
    expect(mechanicalRows(files, proofs).map((row) => row.summary)).toEqual([
      LOCKFILE_ROW,
      STRINGS_ROW,
      RENAME_ROW,
    ]);
  });

  it("joins several proofs of one hunk", () => {
    const [row] = mechanicalRows(
      [strings],
      [proof(strings, "whitespace", "first"), proof(strings, "formatting", "second")],
    );
    expect(row?.summary).toBe("src/strings.ts — first; second (+1 −1)");
  });

  it("keeps proofs whose file or hunk isn't given, with nothing to expand", () => {
    const rows = mechanicalRows([strings], proofs);
    expect(rows.map((row) => [row.summary, row.hunk === null])).toEqual([
      [STRINGS_ROW, false],
      ["docs/getting-started.md — renamed from docs/setup.md, content unchanged", true],
      ["pnpm-lock.yaml — lockfile (pnpm-lock.yaml)", true],
    ]);
  });
});

describe("MechanicalGroup", () => {
  it("shows one collapsed row per mechanical hunk and a row per pure rename", () => {
    renderGroup();
    const group = screen.getByRole("region", { name: "Mechanical changes 3" });
    expect(within(group).getAllByRole("listitem").map(text)).toEqual([
      LOCKFILE_ROW,
      STRINGS_ROW,
      RENAME_ROW,
    ]);
    expect(within(group).getAllByRole("button", { expanded: false }).map(text)).toEqual([
      LOCKFILE_ROW,
      STRINGS_ROW,
    ]);
    expect(within(group).queryAllByRole("region")).toEqual([]);
  });

  it("expands a row into the hunk's card with the proof in its header", async () => {
    const user = userEvent.setup();
    renderGroup();
    await user.click(screen.getByRole("button", { name: STRINGS_ROW }));
    expect(screen.getByRole("button", { name: STRINGS_ROW }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    const card = screen.getByRole("region", { name: "src/strings.ts, lines 3–4" });
    expect(card.querySelector("header")?.textContent).toContain(
      "✓ whitespace only: trailing whitespace",
    );
    expect(within(card).getByText("Mechanical")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: STRINGS_ROW }));
    expect(screen.queryByRole("region", { name: "src/strings.ts, lines 3–4" })).toBeNull();
  });

  it("shows the first 500 lines of a long hunk, then all on request", async () => {
    const user = userEvent.setup();
    renderGroup();
    await user.click(screen.getByRole("button", { name: LOCKFILE_ROW }));
    const card = screen.getByRole("region", { name: "pnpm-lock.yaml, lines 1–701" });
    expect(within(card).getAllByRole("row")).toHaveLength(500);
    await user.click(within(card).getByRole("button", { name: "Show all 701 lines" }));
    expect(within(card).getAllByRole("row")).toHaveLength(701);
    expect(within(card).queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("expands and collapses every row at once", async () => {
    const user = userEvent.setup();
    renderGroup();
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getAllByRole("region", { name: /lines/ })).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryAllByRole("region", { name: /lines/ })).toEqual([]);
  });

  it("has no expand toggle when nothing can expand", () => {
    renderGroup(proofs.slice(0, 1));
    expect(text(screen.getByRole("listitem"))).toBe(RENAME_ROW);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing without proofs", () => {
    const { container } = renderGroup([]);
    expect(container.innerHTML).toBe("");
  });
});

describe("FileNotices", () => {
  const notices = parseFiles([
    "diff --git a/assets/logo.png b/assets/logo.png",
    "index 7777777..8888888 100644",
    "Binary files a/assets/logo.png and b/assets/logo.png differ",
    "diff --git a/assets/new.png b/assets/new.png",
    "new file mode 100644",
    "index 0000000..8888888",
    "Binary files /dev/null and b/assets/new.png differ",
    "diff --git a/scripts/deploy.sh b/scripts/deploy.sh",
    "old mode 100644",
    "new mode 100755",
    "diff --git a/.keep b/.keep",
    "new file mode 100644",
    "index 0000000..e69de29",
    "diff --git a/old.txt b/old.txt",
    "deleted file mode 100644",
    "index e69de29..0000000",
  ]);

  it("lists binary files, mode changes and empty files", () => {
    render(<FileNotices files={[...notices, strings, renamed]} />);
    const region = screen.getByRole("region", { name: "Changes without lines to show" });
    expect(
      within(region)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual([
      "assets/logo.pngbinary file changed",
      "assets/new.png, newbinary file added",
      "scripts/deploy.shmode 100644 → 100755",
      ".keep, newempty file added",
      "old.txt, deletedempty file deleted",
    ]);
  });

  it("lists a mode change on a file that also has lines", () => {
    const [file] = parseFiles([
      "diff --git a/run.sh b/run.sh",
      "old mode 100644",
      "new mode 100755",
      "index 1111111..2222222",
      "--- a/run.sh",
      "+++ b/run.sh",
      "@@ -1 +1 @@",
      "-echo a",
      "+echo b",
    ]);
    if (file === undefined) throw new Error("no file");
    expect(firstHunk(file)).toBeTruthy();
    render(<FileNotices files={[file]} />);
    expect(screen.getByRole("listitem").textContent).toBe("run.shmode 100644 → 100755");
  });

  it("renders nothing when every file has lines to show or a proof", () => {
    const { container } = render(<FileNotices files={[strings, renamed]} />);
    expect(container.innerHTML).toBe("");
  });
});
