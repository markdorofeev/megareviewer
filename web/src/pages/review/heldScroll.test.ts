import { afterEach, describe, expect, it, vi } from "vitest";
import { holdInView } from "./heldScroll.ts";

describe("holdInView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  const setup = () => {
    let resized = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {
          resized = () => {};
        }
      },
    );
    document.body.innerHTML = '<section aria-label="Changes"><p id="label"></p></section>';
    const label = document.getElementById("label");
    if (label === null) throw new Error("no label");
    label.scrollIntoView = vi.fn();
    return { label, resize: () => resized() };
  };

  it("puts the element back at the top while what's above it grows", () => {
    const { label, resize } = setup();
    holdInView("label", "[aria-label=Changes]");
    resize();
    resize();
    expect(label.scrollIntoView).toHaveBeenCalledTimes(2);
    expect(label.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "instant" });
  });

  it("lets go once the reader moves, or after a while", () => {
    vi.useFakeTimers();
    const { label, resize } = setup();
    holdInView("label", "[aria-label=Changes]");
    window.dispatchEvent(new Event("wheel"));
    resize();
    expect(label.scrollIntoView).not.toHaveBeenCalled();

    const again = setup();
    holdInView("label", "[aria-label=Changes]");
    vi.advanceTimersByTime(2500);
    again.resize();
    expect(again.label.scrollIntoView).not.toHaveBeenCalled();
  });
});
