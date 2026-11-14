import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ModelCall } from "../../../../src/domain/review/index.ts";
import { fixtureAnalysisView } from "../../../dev/fixtures/index.ts";
import { chronological, formatOffset, ModelCalls } from "./ModelCalls.tsx";

const calls = fixtureAnalysisView.analysis.modelCalls;

const failed: ModelCall = {
  pass: "decisions",
  attempt: 1,
  startedAt: "2026-10-21T09:00:31.200Z",
  durationMs: 4_000,
  outcome: "failed",
  problems: [],
  error: { kind: "overloaded", message: "Anthropic is overloaded or failing: 529" },
};

describe("ModelCalls", () => {
  it("lists every call in the order it started, a retry after its first try", () => {
    const passes = chronological(calls).map((call) => `${call.pass}/${call.attempt}`);
    expect(passes).toEqual([
      "intent/1",
      "findings/1",
      "risk/1",
      "decisions/1",
      "findings/2",
      "tour/1",
    ]);
  });

  it("says why a pass ran again, and why one failed", () => {
    render(<ModelCalls calls={[...calls, failed]} />);
    fireEvent.click(screen.getByRole("button", { name: "Run details…" }));
    const dialog = screen.getByRole("dialog", { name: "Claude's calls" });

    expect(within(dialog).getByText(/^141\.2 s from the first call/)).toBeTruthy();
    const findings = within(dialog).getAllByRole("row")[2];
    expect(findings?.textContent).toContain("⚠ 2 problems");
    expect(findings?.textContent).toContain(
      "Finding 4's explanation is longer than 300 characters.",
    );
    expect(within(dialog).getByText("✕ Failed: overloaded")).toBeTruthy();
    expect(within(dialog).getByText("Anthropic is overloaded or failing: 529")).toBeTruthy();
  });

  it("shows nothing before Claude has run", () => {
    const { container } = render(<ModelCalls calls={[]} />);
    expect(container.textContent).toBe("");
  });

  it("counts from the run's first call", () => {
    expect([formatOffset(0), formatOffset(65_400), formatOffset(600_000)]).toEqual([
      "+0:00",
      "+1:05",
      "+10:00",
    ]);
  });
});
