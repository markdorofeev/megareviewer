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
  treePath,
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
      ? [`${"  ".repeat(depth)}${entry.name}`]
      : [`${"  ".repeat(depth)}${entry.label}/`, ...outline(entry.children, depth + 1)],
  );

const headings = (entries: readonly TreeEntry[]): number =>
  entries.reduce(
    (sum, entry) => sum + (entry.kind === "file" ? 0 : 1 + headings(entry.children)),
    0,
  );

describe("fileTree", () => {
  it("nests files under their directories, joining top directories without files into their children's", () => {
    expect(outline(tree)).toEqual([
      "delphi_code/domain/",
      "  hosting_services.py",
      "delphi_code/http_api/",
      "  routes/",
      "    hosting_services.py",
      "  app.py",
      "delphi_code/infrastructure/",
      "  keychain.py",
      "web/src/routes/",
      "  setup.tsx",
      "web/src/setup/",
      "  ConnectionsSection.tsx",
      "CONTRIBUTING.md",
    ]);
  });

  it("collapses a chain only while its directories hold no files and one directory", () => {
    const deep = fileTree(["a/b/c/one.ts", "a/b/two.ts", "x/y/z/three.ts", "x/y/z/four.ts"]);
    expect(outline(deep)).toEqual([
      "a/b/",
      "  c/",
      "    one.ts",
      "  two.ts",
      "x/y/z/",
      "  four.ts",
      "  three.ts",
    ]);
  });

  it("gives a directory of one file a heading", () => {
    expect(outline(fileTree(["a/one.ts", "a/b/two.ts", "c.ts"]))).toEqual([
      "a/",
      "  b/",
      "    two.ts",
      "  one.ts",
      "c.ts",
    ]);
  });

  it("keeps a module's heading, and leaves out its repeated package path", () => {
    const svm = "substratevm/src/com.oracle.svm.core/src/com/oracle/svm/core";
    const java = fileTree([
      `${svm}/pgo/A.java`,
      `${svm}/thread/B.java`,
      "substratevm/src/com.oracle.svm.hosted/src/com/oracle/svm/hosted/C.java",
      "substratevm/mx.substratevm/suite.py",
    ]);
    expect(outline(java)).toEqual([
      "substratevm/mx.substratevm/",
      "  suite.py",
      "substratevm/src/com.oracle.svm.core/",
      "  pgo/",
      "    A.java",
      "  thread/",
      "    B.java",
      "substratevm/src/com.oracle.svm.hosted/",
      "  C.java",
    ]);
    expect(java.map((entry) => (entry.kind === "directory" ? entry.folder : null))).toEqual([
      "folder",
      "module",
      "module",
    ]);
  });

  it("takes fewer headings than files on the many-folder fixtures", () => {
    const counts = [JAVA_SERVICE_PATHS, MONOREPO_PATHS, DEEP_APP_PATHS].map((paths) => [
      headings(fileTree(paths)),
      paths.length,
    ]);
    // A directory of one file had no heading before v4: 13, 9 and 22.
    expect(counts).toEqual([
      [18, 24],
      [20, 23],
      [22, 27],
    ]);
  });
});

describe("treePath", () => {
  it("leaves out a module's package path after src/, and only that", () => {
    expect(treePath("m/com.acme.core/src/com/acme/core/pgo/A.java")).toBe(
      "m/com.acme.core/pgo/A.java",
    );
    expect(treePath("m/com.acme.core/src/com/acme/other/A.java")).toBe(
      "m/com.acme.core/src/com/acme/other/A.java",
    );
    expect(treePath("src/main/java/com/acme/A.java")).toBe("src/main/java/com/acme/A.java");
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

/** A file's row, by the end of its path. */
const row = (name: string): HTMLElement => {
  const one = screen
    .queryAllByRole("treeitem")
    .find((item) => item.dataset.key?.endsWith(name) && !item.dataset.key.endsWith("/"));
  if (one === undefined) throw new Error(`no row for ${name}`);
  return one;
};
const heading = (path: string) =>
  screen.queryAllByRole("treeitem").find((item) => item.dataset.key === `${path}/`) ?? null;

const entries = paths.map((path) => ({
  path,
  status: "modified" as const,
  additions: 1,
  deletions: 0,
}));

const renderRail = (current: string | null, onGo = vi.fn()) =>
  render(<FileTree files={entries} activePath={current} onSelect={onGo} />);

describe("FileTree as the rail", () => {
  it("shows directory headings and a row per file", () => {
    renderRail(null);
    const rail = screen.getByRole("tree", { name: "Changed files" });
    expect(heading("web/src/routes")?.textContent).toBe("web/src/routes");
    expect(
      within(rail)
        .getAllByRole("treeitem")
        .filter((item) => item.hasAttribute("aria-selected")),
    ).toHaveLength(paths.length);
  });

  it("selects the file in view and only it", () => {
    renderRail("delphi_code/http_api/routes/hosting_services.py");
    expect(row("routes/hosting_services.py").getAttribute("aria-selected")).toBe("true");
    for (const name of ["app.py", "domain/hosting_services.py", "CONTRIBUTING.md"]) {
      expect(row(name).getAttribute("aria-selected")).toBe("false");
    }
  });

  it("opens the directories down to the file that comes into view, and leaves the others closed", async () => {
    const { rerender } = renderRail("CONTRIBUTING.md");
    await userEvent.click(heading("delphi_code/http_api") as HTMLElement);
    await userEvent.click(heading("web/src/routes") as HTMLElement);
    expect(heading("delphi_code/http_api/routes")).toBeNull();

    rerender(
      <FileTree
        files={entries}
        activePath="delphi_code/http_api/routes/hosting_services.py"
        onSelect={vi.fn()}
      />,
    );
    expect(heading("delphi_code/http_api")?.getAttribute("aria-expanded")).toBe("true");
    expect(row("routes/hosting_services.py").getAttribute("aria-selected")).toBe("true");
    expect(heading("web/src/routes")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps closed the directory of the file in view when the reviewer closes it, with its count", async () => {
    renderRail("delphi_code/http_api/app.py");
    await userEvent.click(heading("delphi_code/http_api") as HTMLElement);
    expect(heading("delphi_code/http_api")?.getAttribute("aria-expanded")).toBe("false");
    expect(heading("delphi_code/http_api")?.textContent).toBe("delphi_code/http_api2");
    expect(() => row("http_api/app.py")).toThrow();
  });

  it("gives every row its full path and status in its tooltip", () => {
    renderRail(null);
    expect(row("keychain.py").title).toBe("delphi_code/infrastructure/keychain.py\nModified");
  });

  it("goes to a file's card on a click", async () => {
    const onGo = vi.fn();
    renderRail(null, onGo);
    await userEvent.click(row("keychain.py"));
    expect(onGo).toHaveBeenCalledWith("delphi_code/infrastructure/keychain.py");
  });

  it("is one Tab stop, moved through with the arrow keys", async () => {
    const onGo = vi.fn();
    renderRail("delphi_code/http_api/app.py", onGo);
    const stops = screen.getAllByRole("treeitem").filter((item) => item.tabIndex === 0);
    expect(stops).toEqual([row("http_api/app.py")]);
    row("http_api/app.py").focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(row("routes/hosting_services.py"));
    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(heading("delphi_code/http_api/routes"));
    await userEvent.keyboard("{ArrowLeft}");
    expect(heading("delphi_code/http_api/routes")?.getAttribute("aria-expanded")).toBe("false");
    await userEvent.keyboard("{ArrowRight}");
    expect(heading("delphi_code/http_api/routes")?.getAttribute("aria-expanded")).toBe("true");
    await userEvent.keyboard("{End}{Enter}");
    expect(onGo).toHaveBeenCalledWith("CONTRIBUTING.md");
    await userEvent.keyboard("{Home}{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: /Filter files/ }));
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(heading("delphi_code/domain"));
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
