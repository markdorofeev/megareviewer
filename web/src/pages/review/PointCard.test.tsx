import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HunkId } from "../../../../src/domain/diff/index.ts";
import { type Point, PointId } from "../../../../src/domain/review/index.ts";
import { fixtureAnalysisView } from "../../../dev/fixtures/index.ts";
import { CallPeek, createCallPeekHandle } from "../../review/index.ts";
import { checkingTestPayload } from "./calls.tsx";
import { partIndex } from "./model.ts";
import { RiskNote } from "./PointCard.tsx";

const analysis = fixtureAnalysisView.analysis;
const index = partIndex(analysis);
const [file] = analysis.files;
const hunk = file?.hunks[0];
if (file === undefined || hunk === undefined) throw new Error("the fixture changes files");
const shown = hunk.lines.find((line) => line.kind !== "del" && line.newLine !== null);
if (shown?.newLine == null) throw new Error("the fixture's first hunk shows new lines");

const risk: Point = {
  id: PointId.parse(`r:${hunk.id}`),
  kind: "risk",
  title: "Any signed-in user could read another user's receipt.",
  explanation: "",
  path: file.path,
  lines: { hunkId: hunk.id, side: "new", startLine: shown.newLine, line: shown.newLine },
  hunkIds: [hunk.id],
  severity: null,
  suggestion: null,
  mismatch: null,
};
const checked: Point = {
  ...risk,
  checkedBy: {
    test: "answers 404 for another user's order",
    checks: "Another user's order gets 404 and no receipt text.",
    lines: { hunkId: hunk.id, side: "new", startLine: shown.newLine, line: shown.newLine },
    path: "src/routes/orders.test.ts",
  },
};

const actions = {
  state: "open" as const,
  saving: false,
  readOnly: false,
  current: false,
  onRaise: vi.fn(),
  onState: vi.fn(),
};

describe("RiskNote", () => {
  it("names the test that checks it, where, and what it asserts, with a word and not a color", () => {
    render(<RiskNote point={checked} {...actions} />);
    const line = screen.getByText((_, node) => node?.getAttribute("data-slot") === "checked-by");
    expect(line.textContent).toBe(
      "Checked by answers 404 for another user's order in orders.test.ts, which asserts: Another user's order gets 404 and no receipt text.",
    );
    expect(line.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("says nothing of tests when none checks it, and is the same risk either way", () => {
    const { container } = render(<RiskNote point={risk} {...actions} />);
    expect(container.querySelector("[data-slot=checked-by]")).toBeNull();
    const [unchecked, withTest] = [risk, checked].map((point) => {
      const { container: one } = render(<RiskNote point={point} {...actions} />);
      const article = one.querySelector("article");
      return [article?.dataset.kind, article?.querySelectorAll("button").length];
    });
    expect(withTest).toEqual(unchecked);
  });

  it("opens the test's code from its name, by the keyboard too", async () => {
    const handle = createCallPeekHandle();
    const payload = checkingTestPayload(checked, index);
    if (payload === null) throw new Error("the page knows the test's hunk");
    render(
      <>
        <RiskNote point={checked} {...actions} test={{ handle, payload }} />
        <CallPeek handle={handle} onGoTo={() => {}} />
      </>,
    );
    const name = screen.getByRole("button", { name: "answers 404 for another user's order" });
    await act(async () => {
      name.focus();
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    const card = await screen.findByLabelText("Test answers 404 for another user's order");
    expect(within(card).getByRole("button", { name: "Go to file" })).toBeDefined();
  });
});

describe("checkingTestPayload", () => {
  it("is the part showing the test's lines, named by the test", () => {
    const payload = checkingTestPayload(checked, index);
    expect(payload?.symbol).toBe("answers 404 for another user's order");
    expect(payload?.targets.map((target) => target.hunk.id)).toEqual([hunk.id]);
  });

  it("is null for a point without a checking test, or one on a hunk the page doesn't know", () => {
    expect(checkingTestPayload(risk, index)).toBeNull();
    const unknown = HunkId.parse("h_ffffffffffffffff");
    const elsewhere: Point = {
      ...checked,
      checkedBy: {
        test: "answers 404 for another user's order",
        checks: "Another user's order gets 404.",
        lines: { hunkId: unknown, side: "new", startLine: 1, line: 1 },
        path: "src/routes/orders.test.ts",
      },
    };
    expect(checkingTestPayload(elsewhere, index)).toBeNull();
  });
});
