import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HunkId } from "../../../../src/domain/diff/index.ts";
import { DiffLine, type LineMark, segments } from "./diff-line.tsx";
import type { ViewLine } from "./rows.ts";

const line = (overrides: Partial<ViewLine> = {}): ViewLine => ({
  key: "h:0",
  hunkId: HunkId.parse("h_0000000000000001"),
  kind: "add",
  oldNo: null,
  newNo: 7,
  text: "  return save(host);",
  tokens: [
    { text: "  ", type: null },
    { text: "return", type: "keyword" },
    { text: " sa", type: null },
    { text: "ve", type: "function" },
    { text: "(host);", type: null },
  ],
  wordRanges: [],
  notes: [],
  ...overrides,
});

const mark = (start: number, end: number): LineMark => ({
  start,
  end,
  render: (code) => <u data-mark={start}>{code}</u>,
});

describe("segments", () => {
  it("cuts at the edges of marks, without counting them as changed", () => {
    expect(
      segments(
        "ab cd",
        [{ text: "ab cd", type: null }],
        [{ start: 0, end: 1 }],
        [{ start: 3, end: 5 }],
      ),
    ).toEqual([
      { text: "a", type: null, changed: true, start: 0 },
      { text: "b ", type: null, changed: false, start: 1 },
      { text: "cd", type: null, changed: false, start: 3 },
    ]);
  });
});

describe("DiffLine marks", () => {
  it("wraps a mark's range across syntax tokens and changed words", () => {
    const { container } = render(
      <DiffLine line={line({ wordRanges: [{ start: 9, end: 11 }] })} marks={[mark(9, 13)]} />,
    );
    const marked = container.querySelector("u[data-mark='9']");
    expect(marked?.textContent).toBe("save");
    expect(marked?.querySelector("[data-changed]")?.textContent).toBe("sa");
    expect(marked?.querySelector(".text-syntax-function")?.textContent).toBe("ve");
    expect(container.querySelector("[role=gridcell]:last-child")?.textContent).toContain(
      "  return save(host);",
    );
  });

  it("wraps each mark apart, leaving the rest of the line as it was", () => {
    const { container } = render(
      <DiffLine line={line({ tokens: null, text: "f(g(x))" })} marks={[mark(0, 1), mark(2, 3)]} />,
    );
    expect([...container.querySelectorAll("u")].map((one) => one.textContent)).toEqual(["f", "g"]);
    const unmarked = render(<DiffLine line={line({ tokens: null, text: "f(g(x))" })} />);
    expect(unmarked.container.querySelector("u")).toBeNull();
    expect(unmarked.container.textContent).toBe(container.textContent);
  });
});

describe("a point's mark", () => {
  const cells = (container: HTMLElement) => [
    ...container.querySelectorAll<HTMLElement>("[role=gridcell]"),
  ];
  const marked = (container: HTMLElement) =>
    cells(container).filter((cell) => cell.dataset.pointMark !== undefined);

  it("is on the number beside the code, and no other cell", () => {
    const { container } = render(
      <DiffLine line={line({ kind: "context", oldNo: 6, newNo: 7 })} pointKind="risk" />,
    );
    const [old, current] = cells(container);
    expect(marked(container)).toEqual([current]);
    expect(current?.dataset.pointMark).toBe("risk");
    expect(old?.dataset.pointMark).toBeUndefined();
  });

  it("is on the old number in the old side of a split", () => {
    const { container } = render(
      <DiffLine
        line={line({ kind: "del", oldNo: 6, newNo: null })}
        layout="split-old"
        pointKind="finding"
      />,
    );
    expect(marked(container).map((cell) => cell.textContent)).toEqual(["6"]);
  });

  it("isn't on a decision's lines", () => {
    const { container } = render(<DiffLine line={line()} pointKind="decision" />);
    expect(marked(container)).toEqual([]);
  });

  it("leaves the edge bar to the focus and the open comment box", () => {
    const row = (props: { focused?: boolean; marked?: boolean }) =>
      render(<DiffLine line={line()} pointKind="finding" {...props} />).container.querySelector(
        "[role=row]",
      )?.className ?? "";
    expect(row({})).not.toMatch(/after:w-\[3px\]/);
    expect(row({ focused: true })).toMatch(/after:bg-ring/);
    expect(row({ marked: true })).toMatch(/after:bg-ring/);
  });
});
