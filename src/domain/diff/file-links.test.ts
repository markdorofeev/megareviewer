import { describe, expect, it } from "vitest";
import { type FileChange, type FileSymbols, fileLinks } from "./index.ts";

const LANGUAGES: Readonly<Record<string, string>> = {
  ts: "typescript",
  tsx: "tsx",
  py: "python",
};

const file = (path: string): FileChange => ({
  path,
  oldPath: null,
  status: "modified",
  binary: false,
  oldMode: null,
  newMode: null,
  language: LANGUAGES[path.slice(path.lastIndexOf(".") + 1)] ?? null,
  hunks: [],
  additions: 0,
  deletions: 0,
});

const importing = (...imports: FileSymbols["imports"]): FileSymbols => ({
  definitions: [],
  references: [],
  imports,
});

const links = (paths: readonly string[], symbols: Record<string, FileSymbols>) =>
  fileLinks(paths.map(file), new Map(Object.entries(symbols)));

describe("fileLinks", () => {
  it("links a relative import to the changed file it names", () => {
    expect(
      links(["src/page.ts", "src/lib/text.ts", "src/lib/other.ts"], {
        "src/page.ts": importing({ module: "./lib/text.ts", names: ["slugify"] }),
      }),
    ).toEqual([{ from: "src/page.ts", to: "src/lib/text.ts" }]);
  });

  it("links a Python import to the module, not the whole package", () => {
    const paths = [
      "app/routes/users.py",
      "app/services/users.py",
      "app/services/orders.py",
      "app/models.py",
    ];
    expect(
      links(paths, {
        "app/routes/users.py": importing(
          { module: "app.services.users", names: ["create_user"] },
          { module: "..models", names: ["User"] },
        ),
      }),
    ).toEqual([
      { from: "app/routes/users.py", to: "app/services/users.py" },
      { from: "app/routes/users.py", to: "app/models.py" },
    ]);
  });

  it("links `from package import module` to that module", () => {
    expect(
      links(["app/main.py", "app/services/users.py", "app/services/orders.py"], {
        "app/main.py": importing({ module: "app.services", names: ["users"] }),
      }),
    ).toEqual([{ from: "app/main.py", to: "app/services/users.py" }]);
  });

  it("links a path alias", () => {
    expect(
      links(["web/src/routes/setup.tsx", "web/src/setup/Connections.tsx"], {
        "web/src/routes/setup.tsx": importing({
          module: "@/setup/Connections",
          names: ["Connections"],
        }),
      }),
    ).toEqual([{ from: "web/src/routes/setup.tsx", to: "web/src/setup/Connections.tsx" }]);
  });

  it("makes no link for an import of a file outside the PR or a package", () => {
    expect(
      links(["src/page.ts", "src/lib/text.ts"], {
        "src/page.ts": importing(
          { module: "./lib/dates.ts", names: ["formatDate"] },
          { module: "react", names: ["useState"] },
        ),
      }),
    ).toEqual([]);
  });

  it("links a test to the code it imports, never code to a test", () => {
    expect(
      links(["src/text.ts", "src/text.test.ts", "src/testing/fakes.ts"], {
        "src/text.test.ts": importing(
          { module: "./text.ts", names: ["slugify"] },
          { module: "./testing/fakes.ts", names: ["fakeClock"] },
        ),
        "src/text.ts": importing({ module: "./text.test.ts", names: null }),
      }),
    ).toEqual([
      { from: "src/text.test.ts", to: "src/text.ts" },
      { from: "src/text.test.ts", to: "src/testing/fakes.ts" },
    ]);
  });

  it("links within a language family only, and not a file to itself", () => {
    expect(
      links(["web/api.ts", "web/api.py", "web/page.tsx"], {
        "web/page.tsx": importing({ module: "./api", names: ["get"] }),
        "web/api.ts": importing({ module: "./api", names: null }),
      }),
    ).toEqual([{ from: "web/page.tsx", to: "web/api.ts" }]);
  });
});
