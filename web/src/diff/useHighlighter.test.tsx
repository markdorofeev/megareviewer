import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Highlighter } from "./highlight.ts";
import { firstHunk, modifiedFile } from "./testing.ts";
import { HighlighterContext, useHighlighter } from "./useHighlighter.ts";

const file = modifiedFile("src/a.ts", ["@@ -1,1 +1,1 @@", "-const a = 1;", "+const a = 2;"]);
const hunk = firstHunk(file);

/** Colors every line at once, as Shiki does once its grammar is loaded. */
const instant: Highlighter = {
  highlight: async (code) =>
    code
      .split("\n")
      .map((text) => [{ text, light: "#cf222e", dark: null, italic: false, bold: false }]),
};

const Probe = () => {
  const tokens = useHighlighter(hunk, file);
  return <p>{tokens === null ? "plain" : "highlighted"}</p>;
};

const act = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const actBefore = act.IS_REACT_ACT_ENVIRONMENT;
afterEach(() => {
  act.IS_REACT_ACT_ENVIRONMENT = actBefore;
});

describe("useHighlighter", () => {
  it("shows tokens that are ready before its effect runs", async () => {
    // Outside act, React runs effects a task after the render, and a fast highlight resolves in
    // between: the card has to show it all the same, not stay plain.
    act.IS_REACT_ACT_ENVIRONMENT = false;
    const box = document.createElement("div");
    const root = createRoot(box);
    root.render(
      <HighlighterContext.Provider value={instant}>
        <Probe />
      </HighlighterContext.Provider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(box.textContent).toBe("highlighted");
    root.unmount();
  });
});
