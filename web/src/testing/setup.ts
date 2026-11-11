import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library cleans up by itself only when Vitest's globals are on.
afterEach(cleanup);

// jsdom has no matchMedia; the theme and narrow layouts ask it. Nothing matches: a light, wide page.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}
