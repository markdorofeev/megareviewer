import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  parseDiffPalette,
  parseThemePreference,
  resolveTheme,
  useTheme,
} from "./theme.ts";

const stubSystemDark = (matches: boolean) =>
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );

describe("theme preferences", () => {
  it("falls back to the system theme and the default palette on anything unknown", () => {
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("sepia")).toBe("system");
    expect(parseThemePreference(undefined)).toBe("system");
    expect(parseDiffPalette("cb")).toBe("cb");
    expect(parseDiffPalette(1)).toBe("default");
  });

  it("resolves system to what the OS prefers", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("sets and clears the class and the data attribute independently", () => {
    const root = document.createElement("html");
    applyTheme(root, "dark", "cb");
    expect(root.className).toBe("dark");
    expect(root.dataset.diffPalette).toBe("cb");
    applyTheme(root, "light", "cb");
    expect(root.className).toBe("");
    expect(root.dataset.diffPalette).toBe("cb");
    applyTheme(root, "light", "default");
    expect(root.dataset.diffPalette).toBeUndefined();
  });
});

describe("useTheme", () => {
  beforeEach(() => stubSystemDark(false));
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    applyTheme(document.documentElement, "light", "default");
  });

  it("reads what's stored, as theme.js does", () => {
    window.localStorage.setItem("megareviewer:theme", JSON.stringify("dark"));
    window.localStorage.setItem("megareviewer:diffPalette", JSON.stringify("cb"));
    const { result } = renderHook(() => useTheme());
    expect(result.current).toMatchObject({
      theme: "dark",
      resolvedTheme: "dark",
      diffPalette: "cb",
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.diffPalette).toBe("cb");
  });

  it("persists each preference without touching the other", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setDiffPalette("cb"));
    expect(result.current).toMatchObject({ theme: "system", resolvedTheme: "light" });
    expect(document.documentElement.dataset.diffPalette).toBe("cb");
    act(() => result.current.setTheme("dark"));
    expect(result.current.diffPalette).toBe("cb");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("megareviewer:theme")).toBe('"dark"');
  });

  it("follows the system when nothing is chosen", () => {
    stubSystemDark(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolvedTheme).toBe("dark");
  });
});
