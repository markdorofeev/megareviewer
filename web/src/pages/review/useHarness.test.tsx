import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessUse } from "../../../../contracts/index.ts";
import { fixtureAnalysisView, fixtureModelOptions } from "../../../dev/fixtures/index.ts";
import { testApi } from "../../testing/api.tsx";
import { fakeFetch, jsonResponse } from "../../testing/fetch.ts";
import { ClaudeElement } from "./ClaudeElement.tsx";
import { harnessLine, LOADING_REFRESH_MS, useHarness } from "./useHarness.ts";

const { id } = fixtureAnalysisView.analysis;
const ready = (inPrompt: readonly string[], onRequest: number): HarnessUse => ({
  status: "ready",
  inPrompt,
  onRequest,
});
const without = (status: "loading" | "none" | "failed"): HarnessUse => ({
  status,
  inPrompt: [],
  onRequest: 0,
});

describe("harnessLine", () => {
  it("names the guideline files, counts what they import, and what's left to read", () => {
    expect(harnessLine(ready(["CLAUDE.md", "a.md", "b.md", "c.md"], 66))).toBe(
      "Reads CLAUDE.md and 3 files it imports; 66 more on request",
    );
    expect(harnessLine(ready(["REVIEW.md"], 0))).toBe("Reads REVIEW.md");
    expect(harnessLine(ready(["REVIEW.md", "CLAUDE.md", "a.md"], 1))).toBe(
      "Reads REVIEW.md, CLAUDE.md, and 1 file they import; 1 more on request",
    );
    expect(harnessLine(ready(["rules.md"], 1))).toBe("Reads 1 file imported; 1 more on request");
    expect(harnessLine(ready([], 1))).toBe("Can read 1 guideline file on request");
  });

  it("says nothing while it loads, when it couldn't be, and with nothing to use", () => {
    for (const harness of [
      null,
      without("loading"),
      without("none"),
      without("failed"),
      ready([], 0),
    ]) {
      expect(harnessLine(harness)).toBeNull();
    }
  });
});

describe("the Request AI review tooltip's line", () => {
  const button = (harness: HarnessUse | null, locked: string | null = null) => {
    const { analysis } = fixtureAnalysisView;
    render(
      <ClaudeElement
        analysis={{
          ...analysis,
          usage: [],
          stages: {
            ...analysis.stages,
            intent: "skipped",
            findings: "skipped",
            steps: "skipped",
          },
        }}
        choice={{
          options: fixtureModelOptions.options,
          chosen: fixtureModelOptions.options[1] ?? null,
          defaultId: fixtureModelOptions.defaultId,
          locked,
          choose: () => {},
        }}
        running={false}
        starting={false}
        error={null}
        points={[]}
        narrowed={null}
        onNarrow={() => {}}
        onRun={() => {}}
        harness={harness}
      />,
    );
    const describedBy = screen
      .getByRole("button", { name: "Request AI review" })
      .getAttribute("aria-describedby");
    return document.getElementById(describedBy ?? "")?.textContent;
  };
  const RUNS = "Runs Sonnet 5.5 through Claude Code, on your Pro plan";

  it("follows what runs, once the harness is loaded", () => {
    expect(button(ready(["CLAUDE.md"], 2))).toBe(`${RUNS}. Reads CLAUDE.md; 2 more on request`);
  });

  it.each([null, without("loading"), without("none"), without("failed")])(
    "isn't there for %o",
    (harness) => {
      expect(button(harness)).toBe(RUNS);
    },
  );

  it("isn't there when nothing can run", () => {
    expect(button(ready(["CLAUDE.md"], 2), "Claude Code isn't signed in")).toBe(
      "Claude Code isn't signed in",
    );
  });
});

describe("useHarness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const Shown = () => <p>{useHarness(id)?.status ?? "unread"}</p>;
  const shown = async (answers: readonly (HarnessUse | null)[]) => {
    let at = 0;
    const { fetch, requests } = fakeFetch(() => {
      const answer = answers[Math.min(at, answers.length - 1)] ?? null;
      at += 1;
      return answer === null
        ? jsonResponse(500, { error: { code: "internal", message: "The store is locked" } })
        : jsonResponse(200, answer);
    });
    const { wrapper } = testApi({ fetch });
    const { unmount } = render(<Shown />, { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(0));
    const wait = () => act(() => vi.advanceTimersByTimeAsync(LOADING_REFRESH_MS));
    return { requests, wait, unmount };
  };

  it("asks again while it loads, and no more once it's in", async () => {
    const { requests, wait } = await shown([without("loading"), ready(["REVIEW.md"], 0)]);
    expect(screen.getByText("loading")).toBeTruthy();
    expect(requests.map((request) => request.url)).toEqual([`/api/analyses/${id}/harness`]);
    await wait();
    expect(screen.getByText("ready")).toBeTruthy();
    await wait();
    expect(requests).toHaveLength(2);
  });

  it("reads again when the window is back in focus, and keeps what it has when that fails", async () => {
    const { requests } = await shown([ready(["REVIEW.md"], 0), null]);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(requests).toHaveLength(2);
    expect(screen.getByText("ready")).toBeTruthy();
  });

  it("stops when the page is left", async () => {
    const { requests, wait, unmount } = await shown([without("loading")]);
    unmount();
    await wait();
    expect(requests).toHaveLength(1);
  });
});
