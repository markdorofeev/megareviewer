import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEEP_APP_PATHS, JAVA_SERVICE_PATHS, MONOREPO_PATHS } from "../../../dev/fixtures/index.ts";
import { FileTree } from "../../review/index.ts";
import {
  byTreePath,
  fileTree,
  type TreeEntry,
  treeOrder,
  treeRoot,
} from "../../review/tree/paths.ts";
import { fileInView } from "./useFileInView.ts";

// delphi-code #2's code files: two hosting_services.py, a chain web/src/, files at the top level.
const paths = [
  "delphi_code/domain/hosting_services.py",
  "delphi_code/http_api/app.py",
  "delphi_code/http_api/routes/hosting_services.py",
  "delphi_code/infrastructure/keychain.py",
  "web/src/routes/setup.tsx",
  "web/src/setup/ConnectionsSection.tsx",
  "CONTRIBUTING.md",
];
const tree = fileTree(paths);

/** Headings and file rows, indented by depth: the tree as the rail draws it. */
const outline = (entries: readonly TreeEntry[], depth = 0): string[] =>
  entries.flatMap((entry) =>
    entry.kind === "file"
      ? [`${"  ".repeat(depth)}${entry.directory ?? ""}${entry.name}`]
      : [`${"  ".repeat(depth)}${entry.label}`, ...outline(entry.children, depth + 1)],
  );

const headings = (entries: readonly TreeEntry[]): number =>
  entries.reduce(
    (sum, entry) => sum + (entry.kind === "file" ? 0 : 1 + headings(entry.children)),
    0,
  );

describe("fileTree", () => {
  it("nests files under their directories, one heading for a chain, none for a lone file", () => {
    expect(outline(tree)).toEqual([
      "delphi_code/",
      "  domain/hosting_services.py",
      "  http_api/",
      "    routes/hosting_services.py",
      "    app.py",
      "  infrastructure/keychain.py",
      "web/src/",
      "  routes/setup.tsx",
      "  setup/ConnectionsSection.tsx",
      "CONTRIBUTING.md",
    ]);
  });

  it("collapses a chain only while its directories hold no files and one directory", () => {
    const deep = fileTree(["a/b/c/one.ts", "a/b/two.ts", "x/y/z/three.ts", "x/y/z/four.ts"]);
    expect(outline(deep)).toEqual([
      "a/b/",
      "  c/one.ts",
      "  two.ts",
      "x/y/z/",
      "  four.ts",
      "  three.ts",
    ]);
  });

  it("gives a directory of one file no heading, the row naming the directories down to it", () => {
    const [only] = fileTree(["packages/config-eslint/index.js"]);
    expect(only).toEqual({
      kind: "file",
      path: "packages/config-eslint/index.js",
      name: "index.js",
      directory: "packages/config-eslint/",
    });
    expect(outline(fileTree(["a/one.ts", "a/b/two.ts", "c.ts"]))).toEqual([
      "a/",
      "  b/two.ts",
      "  one.ts",
      "c.ts",
    ]);
  });

  it("takes fewer headings than files on the many-folder fixtures", () => {
    const counts = [JAVA_SERVICE_PATHS, MONOREPO_PATHS, DEEP_APP_PATHS].map((paths) => [
      headings(fileTree(paths)),
      paths.length,
    ]);
    // Before lone files lost their headings: 23 for 24, 25 for 23 and 35 for 27.
    expect(counts).toEqual([
      [13, 24],
      [9, 23],
      [22, 27],
    ]);
  });
});

describe("treeRoot", () => {
  it("lifts out the directory every file is in", () => {
    const { root, entries } = treeRoot(fileTree(DEEP_APP_PATHS));
    expect(root).toBe("web/");
    expect(entries.map((entry) => (entry.kind === "file" ? entry.name : entry.label))).toEqual([
      "src/",
      "tests/e2e/",
    ]);
  });

  it("leaves a tree with more than one entry at its top as it is", () => {
    expect(treeRoot(tree)).toEqual({ root: null, entries: tree });
    const single = fileTree(["a/b/one.ts"]);
    expect(treeRoot(single)).toEqual({ root: null, entries: single });
  });
});

describe("treeOrder", () => {
  it("lists the files in the order the page shows them, whatever order they came in", () => {
    const order = treeOrder(fileTree([...paths].reverse()));
    expect(order).toEqual([...paths].sort(byTreePath));
    expect(order.indexOf("delphi_code/http_api/routes/hosting_services.py")).toBeLessThan(
      order.indexOf("delphi_code/http_api/app.py"),
    );
  });
});

/** File rows only: directory headings are buttons too, titled with a trailing slash. */
const row = (name: string, at = 0): HTMLElement => {
  const found = screen
    .getAllByRole("button")
    .filter((button) => !button.title.endsWith("/") && button.title.endsWith(name));
  const one = found[at];
  if (one === undefined) throw new Error(`no row for ${name}`);
  return one;
};

const entries = paths.map((path) => ({
  path,
  status: "modified" as const,
  additions: 1,
  deletions: 0,
}));

const renderRail = (current: string | null, onGo = vi.fn()) =>
  render(<FileTree files={entries} activePath={current} onSelect={onGo} />);

describe("FileTree as the rail", () => {
  it("shows directory headings, a row per file, and no contract counts", () => {
    renderRail(null);
    const rail = screen.getByRole("navigation", { name: "Changed files" });
    expect(within(rail).getByTitle("web/src/").textContent).toBe("web/src/");
    expect(
      within(rail)
        .getAllByRole("button")
        .filter((button) => !button.title.endsWith("/")),
    ).toHaveLength(paths.length);
    expect(row("routes/hosting_services.py").textContent).not.toContain("contract");
    expect(within(rail).getByTitle("delphi_code/").textContent).toBe("delphi_code/");
  });

  it("highlights the file in view and only it", () => {
    renderRail("delphi_code/http_api/routes/hosting_services.py");
    expect(row("routes/hosting_services.py").getAttribute("aria-current")).toBe("location");
    for (const name of ["app.py", "domain/hosting_services.py", "CONTRIBUTING.md"]) {
      expect(row(name).getAttribute("aria-current")).toBeNull();
    }
  });

  it("opens the directories down to the file that comes into view, and leaves the others closed", async () => {
    const { rerender } = renderRail("CONTRIBUTING.md");
    await userEvent.click(screen.getByTitle("delphi_code/"));
    await userEvent.click(screen.getByTitle("web/src/"));
    expect(screen.queryByTitle("delphi_code/http_api/")).toBeNull();

    rerender(
      <FileTree
        files={entries}
        activePath="delphi_code/http_api/routes/hosting_services.py"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTitle("delphi_code/").getAttribute("aria-expanded")).toBe("true");
    expect(row("routes/hosting_services.py").getAttribute("aria-current")).toBe("location");
    expect(screen.getByTitle("web/src/").getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps closed the directory of the file in view when the reviewer closes it", async () => {
    renderRail("delphi_code/http_api/app.py");
    await userEvent.click(screen.getByTitle("delphi_code/http_api/"));
    expect(screen.getByTitle("delphi_code/http_api/").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTitle("delphi_code/http_api/app.py")).toBeNull();
  });

  it("names a lone file's directory on its row, and gives every row its full path", () => {
    renderRail(null);
    const keychain = row("keychain.py");
    expect(keychain.textContent).toContain("infrastructure/keychain.py");
    // The title is the row's description to screen readers, and its tooltip.
    expect(keychain.title).toBe("delphi_code/infrastructure/keychain.py");
    expect(screen.queryByTitle("delphi_code/infrastructure/")).toBeNull();
  });

  it("says once the directory every file is in, rather than indenting them all under it", () => {
    render(
      <FileTree
        files={["web/src/a.ts", "web/src/b.ts", "web/tests/c.ts", "web/tests/d.ts"].map((path) => ({
          path,
          status: "modified" as const,
          additions: 1,
          deletions: 0,
        }))}
        activePath={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/4 files in/).parentElement?.textContent).toBe("4 files in web/");
    expect(screen.getAllByRole("button").filter((button) => button.title === "web/")).toEqual([]);
    expect(screen.getByTitle("web/src/").getAttribute("aria-expanded")).toBe("true");
  });

  it("sticks each directory's heading under its parent's, so the deepest stays on top", () => {
    renderRail(null);
    const outer = screen.getByTitle("delphi_code/");
    const inner = screen.getByTitle("delphi_code/http_api/");
    expect([outer.style.top, inner.style.top]).toEqual(["0px", "24px"]);
    expect(Number(outer.style.zIndex)).toBeGreaterThan(Number(inner.style.zIndex));
  });

  it("goes to a file's card on a click", async () => {
    const onGo = vi.fn();
    renderRail(null, onGo);
    await userEvent.click(row("keychain.py"));
    expect(onGo).toHaveBeenCalledWith("delphi_code/infrastructure/keychain.py");
  });
});

describe("fileInView", () => {
  const cards = [
    { path: "a.py", top: -900 },
    { path: "b.py", top: -100 },
    { path: "c.py", top: 150 },
    { path: "d.py", top: 600 },
  ];

  it("is the last card whose top has passed a quarter of the window", () => {
    expect(fileInView(cards, 800, false)).toBe("c.py");
    expect(fileInView(cards, 400, false)).toBe("b.py");
  });

  it("is the first card before any has reached that line", () => {
    expect(fileInView([{ path: "a.py", top: 300 }], 800, false)).toBe("a.py");
    expect(fileInView([], 800, false)).toBeNull();
  });

  it("is the last card on screen once the page is scrolled to the bottom", () => {
    expect(fileInView(cards, 800, true)).toBe("d.py");
  });
});
