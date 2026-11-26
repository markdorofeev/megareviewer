import { describe, expect, it } from "vitest";
import { HunkId, PartId, type UnchangedCallers } from "../../../../src/domain/diff/index.ts";
import { codeSpans, MAX_STOPS, reachOf, throughOf } from "./brief.ts";
import type { FileOverview, OverviewNode } from "./overview.ts";

const group = (directory: string, more: Partial<OverviewNode> = {}): OverviewNode => ({
  key: `group:${directory}`,
  kind: "group",
  paths: [`${directory}/a.ts`],
  label: `${directory}/`,
  added: 1,
  deleted: 0,
  risk: "logic",
  generated: false,
  entries: [],
  flows: [],
  partIds: [],
  uses: 0,
  badges: [],
  row: 0,
  ...more,
});

const overview = (
  rows: readonly (readonly OverviewNode[])[],
  strip: readonly OverviewNode[] = [],
): FileOverview => ({ rows, edges: [], strip, placeOf: new Map() });

describe("throughOf", () => {
  it("is the overview's rows, each directory by as much of its path as tells it apart", () => {
    const through = throughOf(
      overview(
        [
          [group("web/src/routes", { entries: ["Page: SetupPage"] })],
          [group("app/http/routes", { entries: ["3 routes"] }), group("web/src/api")],
          [group("app/services")],
        ],
        [group("docs")],
      ),
    );
    expect(through).toEqual({
      rows: [
        [{ label: "src/routes", entries: ["Page: SetupPage"] }],
        [
          { label: "http/routes", entries: ["3 routes"] },
          { label: "api", entries: [] },
        ],
        [{ label: "services", entries: [] }],
      ],
      linked: true,
      // The directory apart from the others is counted, not named.
      more: 1,
    });
  });

  it("leaves out what isn't code to read: generated and mechanical", () => {
    const through = throughOf(
      overview([
        [group("web/src/api", { generated: true }), group("src/routes")],
        [group("src/moved", { risk: "mechanical" })],
      ]),
    );
    expect(through?.rows).toEqual([[{ label: "routes", entries: [] }]]);
    expect(through?.more).toBe(0);
  });

  it("names the directories apart when nothing links them", () => {
    const through = throughOf(overview([], [group("src/text"), group("src/utils")]));
    expect(through).toEqual({
      rows: [
        [
          { label: "text", entries: [] },
          { label: "utils", entries: [] },
        ],
      ],
      linked: false,
      more: 0,
    });
  });

  it("stops at the limit and counts the rest", () => {
    const rows = Array.from({ length: MAX_STOPS + 3 }, (_, at) => [group(`d${at}`)]);
    const through = throughOf(overview(rows));
    expect(through?.rows.flat()).toHaveLength(MAX_STOPS);
    expect(through?.more).toBe(3);
  });

  it("is null when there's nothing to name", () => {
    expect(throughOf(overview([], []))).toBeNull();
    expect(throughOf(overview([[group("vendor", { risk: "mechanical" })]]))).toBeNull();
  });
});

const part = (n: number) => PartId.parse(HunkId.parse(`h_${n.toString(16).padStart(16, "0")}`));
const use = (path: string) => ({
  path,
  line: 1,
  use: "call" as const,
  excerpt: { start: 1, lines: ["f()"] },
});
const callers = (n: number, symbol: string, paths: readonly string[], more = 0) =>
  ({ partId: part(n), symbol, uses: paths.map(use), more }) satisfies UnchangedCallers;

describe("reachOf", () => {
  const pathOf = new Map([
    [part(1), "app/factory.py"],
    [part(2), "app/credentials.py"],
    [part(3), "tests/fakes.py"],
  ]);
  const pathOfPart = (id: PartId) => pathOf.get(id);

  it("names the changed definitions code outside the PR uses, and counts the uses", () => {
    expect(
      reachOf(
        [
          callers(1, "create_app", ["app/main.py", "app/cli.py"], 4),
          callers(2, "clone_credentials", ["app/clone.py", "tests/test_clone.py"]),
        ],
        pathOfPart,
      ),
    ).toEqual({ symbols: ["create_app", "clone_credentials"], uses: 7 });
  });

  it("leaves out tests and their helpers on either end", () => {
    expect(
      reachOf(
        [
          callers(3, "FakeHost", ["app/main.py"]),
          callers(2, "clone_credentials", ["tests/test_clone.py"], 2),
        ],
        pathOfPart,
      ),
    ).toBeNull();
    expect(reachOf([], pathOfPart)).toBeNull();
  });
});

describe("codeSpans", () => {
  it("splits model text at its backticks", () => {
    expect(codeSpans("`GET /a` calls `f`, then stops")).toEqual([
      { text: "GET /a", code: true },
      { text: " calls ", code: false },
      { text: "f", code: true },
      { text: ", then stops", code: false },
    ]);
  });

  it("leaves an unclosed backtick as text", () => {
    expect(codeSpans("a ` b")).toEqual([{ text: "a ` b", code: false }]);
  });
});
