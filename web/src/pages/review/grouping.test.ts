import { describe, expect, it } from "vitest";
import { fixtureAnalysisView } from "../../../dev/fixtures/index.ts";
import { byCalls, byFolders, type GroupFile, groupFiles, parseGrouping } from "./grouping.ts";
import { contractRows, mapSections, partIndex, tourSteps } from "./model.ts";
import { fileOverview, filesInCallOrder } from "./overview.ts";

it("reads a stored grouping, and a dropped one as nothing", () => {
  expect(parseGrouping("folders")).toBe("folders");
  expect(parseGrouping("layers")).toBeUndefined();
  expect(parseGrouping(1)).toBeUndefined();
});

const file = (path: string, contract = 0): GroupFile => ({ path, contract });

describe("byFolders", () => {
  it("walks the tree depth first, contract first under each directory, then by name", () => {
    const sections = byFolders([
      file("CONTRIBUTING.md"),
      file("web/src/routes/setup.tsx"),
      file("web/openapi.json"),
      file("delphi_code/services/application.py"),
      file("delphi_code/infrastructure/hosts.py", 2),
      file("delphi_code/infrastructure/keychain.py"),
      file("delphi_code/infrastructure/auth.py", 1),
      file("tests/test_http_api.py"),
    ]);
    expect(sections.map((section) => [section.title, section.paths])).toEqual([
      [
        "delphi_code/infrastructure",
        [
          "delphi_code/infrastructure/auth.py",
          "delphi_code/infrastructure/hosts.py",
          "delphi_code/infrastructure/keychain.py",
        ],
      ],
      ["delphi_code/services", ["delphi_code/services/application.py"]],
      ["Top level", ["CONTRIBUTING.md"]],
      ["tests", ["tests/test_http_api.py"]],
      ["web", ["web/openapi.json"]],
      ["web/src/routes", ["web/src/routes/setup.tsx"]],
    ]);
    expect(sections[0]?.detail).toBe("3 files · 3 contract");
    expect(sections[1]?.detail).toBe("1 file");
  });

  it("puts a directory's own files first when one holds a contract part", () => {
    const sections = byFolders([file("src/a/x.ts", 1), file("src/index.ts", 1)]);
    expect(sections.map((section) => section.title)).toEqual(["src", "src/a"]);
  });
});

describe("on the fixture", () => {
  const analysis = fixtureAnalysisView.analysis;
  const index = partIndex(analysis);
  const order = filesInCallOrder(fileOverview(analysis, tourSteps(analysis, index)));

  it("makes a section per folder on the map, each file's parts together", () => {
    const sections = mapSections(analysis, order, index, (files) => groupFiles("folders", files));
    expect(sections.map((section) => [section.title, section.detail])).toEqual([
      ["Top level", "1 file · 1 contract"],
      ["src/routes", "1 file · 1 contract"],
      ["src/services", "1 file"],
    ]);
    const calls = mapSections(analysis, order, index, byCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.title).toBeNull();
    // The same parts either way, only in another order.
    expect(sections.flatMap((section) => section.partIds).sort()).toEqual(
      [...(calls[0]?.partIds ?? [])].sort(),
    );
  });

  it("lists the contract parts with what they change and why", () => {
    const [section] = mapSections(analysis, order, index);
    expect(
      contractRows(section?.partIds ?? [], index).map(({ path, what, reason }) => ({
        path,
        what,
        reason,
      })),
    ).toEqual([
      {
        path: "src/routes/orders.ts",
        what: "lines 10–24",
        reason: "New public endpoint that reads orders by ID.",
      },
      { path: "package.json", what: "lines 11–18", reason: "Adds a runtime dependency." },
    ]);
  });
});
