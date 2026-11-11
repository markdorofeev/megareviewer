import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modifiedFile } from "./diff/testing.ts";
import {
  DiffViewer,
  FilePath,
  FileTree,
  KeyHint,
  ReviewSubmitPanel,
  type ViewLine,
} from "./index.ts";

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
    { path: "src/http/backoff.ts", status: "added", additions: 7, deletions: 0, contract: 0 },
    { path: "src/util/sleep.ts", status: "renamed", additions: 0, deletions: 0, contract: 0 },
  ] as const;

  it("filters with / and clears with Esc", () => {
    render(<FileTree files={files} activePath={null} onSelect={() => undefined} />);
    fireEvent.keyDown(window, { key: "/" });
    const filter = screen.getByRole("searchbox", { name: "Filter files" });
    expect(document.activeElement).toBe(filter);
    fireEvent.change(filter, { target: { value: "auth" } });
    expect(screen.getByText("1 of 4 files")).toBeTruthy();
    expect(screen.queryByTitle("src/http/retry.ts")).toBeNull();
    fireEvent.keyDown(filter, { key: "Escape" });
    expect(screen.getByText("4 files")).toBeTruthy();
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

  it("marks a new or deleted file by its icon and name, and a renamed one by a chip", () => {
    render(<FileTree files={files} activePath={null} onSelect={() => undefined} />);
    const added = screen.getByTitle("src/http/backoff.ts");
    expect(added.querySelector("svg")?.getAttribute("data-status")).toBe("added");
    expect(added.querySelector("[data-slot=file-name]")?.className).toContain("text-diff-add-fg");
    expect(added.querySelector(".sr-only")?.textContent).toBe(", new");
    expect(added.querySelector("[data-slot=file-status]")).toBeNull();
    const deleted = screen.getByTitle("src/auth/session.ts");
    expect(deleted.querySelector("svg")?.getAttribute("data-status")).toBe("deleted");
    const name = deleted.querySelector("[data-slot=file-name]")?.className;
    expect(name).toContain("text-diff-del-fg");
    expect(name).toContain("line-through");
    expect(deleted.querySelector("[data-slot=file-status]")).toBeNull();
    const renamed = screen.getByTitle("src/util/sleep.ts");
    expect(renamed.querySelector("svg")?.hasAttribute("data-status")).toBe(false);
    expect(renamed.querySelector("[data-slot=file-status]")?.textContent).toBe("renamed");
    const modified = screen.getByTitle("src/http/retry.ts");
    expect(modified.querySelector("svg")?.hasAttribute("data-status")).toBe(false);
    expect(modified.querySelector("[data-slot=file-status]")).toBeNull();
  });

  it("keeps a muted row's name grey and only its icon in the status color", () => {
    render(
      <FileTree
        files={files}
        activePath="src/http/retry.ts"
        neighbors={new Map([["src/http/retry.ts", new Set(["src/util/sleep.ts"])]])}
        onSelect={() => undefined}
      />,
    );
    const added = screen.getByTitle("src/http/backoff.ts");
    expect(added.getAttribute("data-relation")).toBe("other");
    expect(added.querySelector("svg")?.getAttribute("class")).toContain("text-diff-add-fg");
    expect(added.querySelector("[data-slot=file-name]")?.className).not.toContain(
      "text-diff-add-fg",
    );
    expect(
      screen.getByTitle("src/auth/session.ts").querySelector("[data-slot=file-name]")?.className,
    ).toContain("line-through");
  });
});

describe("FilePath", () => {
  const nameOf = (container: HTMLElement) =>
    container.querySelector("[data-slot=file-name]")?.className ?? "";

  it("marks a new file with a plus icon, its name in the add color and a hidden word", () => {
    const { container } = render(
      <FilePath file={{ path: "src/http/backoff.ts", oldPath: null }} status="added" />,
    );
    expect(container.querySelector("svg")?.getAttribute("data-status")).toBe("added");
    expect(nameOf(container)).toContain("text-diff-add-fg");
    expect(container.querySelector(".sr-only")?.textContent).toBe(", new");
    // Only the name is colored; the directory stays muted.
    expect(container.querySelector(".text-muted-foreground")?.textContent).toBe("src/http/");
  });

  it("marks a deleted file with a minus icon and its name struck through", () => {
    const { container } = render(
      <FilePath file={{ path: "src/auth/session.ts", oldPath: null }} status="deleted" />,
    );
    expect(container.querySelector("svg")?.getAttribute("data-status")).toBe("deleted");
    expect(nameOf(container)).toContain("text-diff-del-fg");
    expect(nameOf(container)).toContain("line-through");
    expect(container.querySelector(".sr-only")?.textContent).toBe(", deleted");
  });

  it("has no icon for a modified or renamed file", () => {
    const { container } = render(
      <>
        <FilePath file={{ path: "src/http/retry.ts", oldPath: null }} status="modified" />
        <FilePath file={{ path: "src/sleep.ts", oldPath: "src/wait.ts" }} status="renamed" />
      </>,
    );
    expect(container.querySelector("svg")).toBeNull();
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
