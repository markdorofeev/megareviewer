import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modifiedFile } from "./diff/testing.ts";
import { DiffViewer, FileTree, KeyHint, ReviewSubmitPanel, type ViewLine } from "./index.ts";

const FILE = modifiedFile("src/retry.ts", [
  "@@ -10,4 +10,4 @@ export function retry",
  " a",
  "-b",
  "+B",
  " c",
  " d",
]);

beforeEach(() => {
  // jsdom has no layout, so nothing scrolls.
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("DiffViewer", () => {
  it("labels every changed line for screen readers, not only by color", () => {
    render(<DiffViewer file={FILE} virtualize={false} />);
    const grid = screen.getByRole("grid", { name: "Diff of src/retry.ts" });
    expect(within(grid).getByText(/removed line 11/)).toBeTruthy();
    expect(within(grid).getByText(/added line 11/)).toBeTruthy();
    expect(within(grid).getByText(/Hunk 1 of 1, lines 10 to 13/)).toBeTruthy();
  });

  it("moves the line focus with the arrows and comments on the selection with c", () => {
    const comments: (readonly ViewLine[])[] = [];
    render(
      <DiffViewer file={FILE} virtualize={false} onComment={(lines) => comments.push(lines)} />,
    );
    const grid = screen.getByRole("grid");
    act(() => grid.focus());
    const active = () => document.getElementById(grid.getAttribute("aria-activedescendant") ?? "");
    expect(active()?.textContent).toContain("unchanged line 10");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(active()?.textContent).toContain("removed line 11");
    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });
    expect(grid.querySelectorAll("[aria-selected=true]")).toHaveLength(2);
    fireEvent.keyDown(grid, { key: "c" });
    expect(comments[0]?.map((line) => line.text)).toEqual(["b", "B"]);
  });

  it("shows split halves side by side", () => {
    render(<DiffViewer file={FILE} view="split" virtualize={false} />);
    const old = screen.getByText(/removed line 11/).closest("[role=row]");
    const added = screen.getByText(/added line 11/).closest("[role=row]");
    expect(old?.parentElement).toBe(added?.parentElement);
  });

  it("waits for a click before drawing a deferred file", () => {
    render(<DiffViewer file={FILE} deferred="Generated file" />);
    expect(screen.queryByRole("grid")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load diff" }));
    expect(screen.getByRole("grid")).toBeTruthy();
  });
});

describe("FileTree", () => {
  const files = [
    { path: "src/http/retry.ts", status: "modified", additions: 1, deletions: 1, contract: 0 },
    { path: "src/auth/session.ts", status: "deleted", additions: 0, deletions: 9, contract: 2 },
  ] as const;

  it("filters with / and clears with Esc", () => {
    render(<FileTree files={files} activePath={null} onSelect={() => undefined} />);
    fireEvent.keyDown(window, { key: "/" });
    const filter = screen.getByRole("searchbox", { name: "Filter files" });
    expect(document.activeElement).toBe(filter);
    fireEvent.change(filter, { target: { value: "auth" } });
    expect(screen.getByText("1 of 2 files")).toBeTruthy();
    expect(screen.queryByTitle("src/http/retry.ts")).toBeNull();
    fireEvent.keyDown(filter, { key: "Escape" });
    expect(screen.getByText("2 files")).toBeTruthy();
  });

  it("says a file's status and contract parts in words", () => {
    render(<FileTree files={files} activePath="src/http/retry.ts" onSelect={() => undefined} />);
    const deleted = screen.getByTitle("src/auth/session.ts");
    expect(deleted.textContent).toContain("deleted");
    expect(deleted.textContent).toContain("2 contract");
    // A modified file says nothing about its status.
    const modified = screen.getByTitle("src/http/retry.ts");
    expect(modified.textContent).not.toMatch(/modified|deleted|new|renamed/);
    expect(modified.getAttribute("aria-current")).toBe("location");
  });
});

describe("KeyHint", () => {
  it("hides a letter key's hint when single-key shortcuts are off, not ⌘↵'s", () => {
    window.localStorage.setItem("megareviewer:singleKeyShortcuts", "false");
    const { container } = render(
      <>
        <KeyHint id="nextFile" />
        <KeyHint id="submit" />
      </>,
    );
    expect(container.querySelectorAll("[data-slot=kbd-group]")).toHaveLength(1);
  });
});

describe("ReviewSubmitPanel", () => {
  it("offers only a comment on the author's own PR", () => {
    render(
      <ReviewSubmitPanel
        pending={[]}
        decided={[0, 1]}
        canApprove={false}
        onSubmit={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Publish/ }));
    expect(screen.getAllByText("Not on your own pull request.")).toHaveLength(2);
  });
});
