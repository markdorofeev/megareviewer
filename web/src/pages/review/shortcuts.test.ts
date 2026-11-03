import { describe, expect, it } from "vitest";
import type { Layout } from "./model.ts";
import { shortcutFor } from "./shortcuts.ts";

const press = (
  key: string,
  layout: Layout = "map",
  target: EventTarget | null = document.body,
  modifiers = {},
) =>
  shortcutFor(
    { key, target, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers },
    layout,
  );

describe("shortcutFor", () => {
  it("maps each shortcut key to its action in the map", () => {
    const keys = ["j", "k", "n", "p", "o", "x", "]", "[", "t", "v", "a", "r", "c", "Escape", "?"];
    expect(keys.map((key) => press(key))).toEqual([
      "next-hunk",
      "previous-hunk",
      "next-step",
      "previous-step",
      "open-call",
      "toggle-reviewed",
      "next-unreviewed",
      "previous-unreviewed",
      "jump",
      "toggle-layout",
      "approve",
      "reject",
      "comment",
      "escape",
      "help",
    ]);
    expect(press("z")).toBeNull();
    expect(press("J")).toBeNull();
    expect(press("ArrowRight")).toBeNull();
  });

  it("follows calls with the arrows in the tree, which has no steps or inline calls", () => {
    expect(press("ArrowRight", "tree")).toBe("first-call");
    expect(press("ArrowLeft", "tree")).toBe("back-to-caller");
    expect(press("j", "tree")).toBe("next-hunk");
    expect(press("n", "tree")).toBeNull();
    expect(press("o", "tree")).toBeNull();
  });

  it("opens the palette with ⌘K and Ctrl+K", () => {
    expect(press("k", "map", document.body, { metaKey: true })).toBe("jump");
    expect(press("K", "tree", document.body, { ctrlKey: true })).toBe("jump");
    expect(press("k", "map", document.body, { metaKey: true, shiftKey: true })).toBeNull();
  });

  it("ignores keys typed into text fields", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(press("a", "map", document.createElement(tag))).toBeNull();
      expect(press("k", "map", document.createElement(tag), { metaKey: true })).toBeNull();
    }
  });

  it("leaves browser shortcuts alone", () => {
    expect(press("r", "map", document.body, { metaKey: true })).toBeNull();
    expect(press("c", "map", document.body, { ctrlKey: true })).toBeNull();
    expect(press("n", "map", document.body, { altKey: true })).toBeNull();
  });
});
