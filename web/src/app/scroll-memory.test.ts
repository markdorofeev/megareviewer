import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigate } from "./router.ts";
import { rememberScroll } from "./scroll-memory.ts";

const ROOT = '<div id="root"><main></main></div>';

describe("rememberScroll", () => {
  let resized = () => {};
  let scrollY = 0;
  /** How far the window can scroll: what the page has rendered. */
  let room = 0;
  const scrollTo = vi.fn(({ top }: ScrollToOptions) => {
    scrollY = Math.min(top ?? 0, room);
  });
  let stop = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    scrollY = 0;
    room = 10_000;
    scrollTo.mockClear();
    vi.stubGlobal("scrollTo", scrollTo);
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
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
    document.body.innerHTML = ROOT;
    stop = rememberScroll();
  });

  afterEach(() => {
    stop();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/");
  });

  const scroll = (y: number) => {
    scrollY = y;
    window.dispatchEvent(new Event("scroll"));
  };

  const back = (state: unknown) => {
    window.history.replaceState(state, "", "/review/a_1");
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  };

  it("keeps a page's place on its entry, and opens the next page at the top", () => {
    const replace = vi.spyOn(window.history, "replaceState");
    scroll(1200);
    navigate("/preferences");
    expect(replace).toHaveBeenCalledWith({ scrollY: 1200 }, "");
    expect(window.history.state).toBeNull();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "instant" });
  });

  it("saves the place once the reader stops scrolling", () => {
    scroll(300);
    scroll(640);
    expect(window.history.state).toBeNull();
    vi.advanceTimersByTime(200);
    expect(window.history.state).toEqual({ scrollY: 640 });
  });

  it("keeps what else the entry holds", () => {
    window.history.replaceState({ other: 1 }, "");
    scroll(80);
    vi.advanceTimersByTime(200);
    expect(window.history.state).toEqual({ other: 1, scrollY: 80 });
  });

  it("goes back to the place once the page is tall enough, and not onto its skeleton", () => {
    room = 0;
    document.body.innerHTML = `<div id="root"><main><div aria-busy="true"></div></main></div>`;
    back({ scrollY: 2400 });
    room = 3000;
    resized();
    expect(scrollY).toBe(0);

    document.body.innerHTML = ROOT;
    room = 900;
    resized();
    expect(scrollY).toBe(900);
    room = 5000;
    resized();
    expect(scrollY).toBe(2400);
  });

  it("gives up when the reader moves first", () => {
    room = 100;
    back({ scrollY: 2400 });
    resized();
    window.dispatchEvent(new Event("wheel"));
    room = 5000;
    resized();
    expect(scrollY).toBe(100);
  });

  it("drops a save the page left behind was waiting on", () => {
    scroll(700);
    back(null);
    vi.advanceTimersByTime(200);
    expect(window.history.state).toBeNull();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "instant" });
  });

  it("comes back to the place after a reload", () => {
    stop();
    window.history.replaceState({ scrollY: 500 }, "");
    stop = rememberScroll();
    resized();
    expect(scrollY).toBe(500);
  });
});
