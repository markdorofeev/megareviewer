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
    const keys = ["n", "p", "v", "a", "r", "c", "Escape", "?"];
    expect(keys.map((key) => press(key))).toEqual([
      "next-file",
      "previous-file",
      "toggle-layout",
      "approve",
      "reject",
      "comment",
      "escape",
      "help",
    ]);
    for (const key of ["j", "k", "o", "x", "[", "]", "t", "z", "J", "ArrowRight"]) {
      expect(press(key)).toBeNull();
    }
  });

  it("leaves the overview's arrows and Enter to the focused file, and file keys to the map", () => {
    for (const key of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Enter"]) {
      expect(press(key, "overview")).toBeNull();
    }
    for (const key of ["n", "p", "a", "c", "Escape"]) {
      expect(press(key, "overview")).toBeNull();
    }
    expect(press("v", "overview")).toBe("toggle-layout");
    expect(press("?", "overview")).toBe("help");
  });

  it("ignores keys typed into text fields", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(press("a", "map", document.createElement(tag))).toBeNull();
    }
  });

  it("works from a checkbox or radio button, which take no typing", () => {
    for (const type of ["checkbox", "radio"]) {
      const input = document.createElement("input");
      input.type = type;
      expect(press("n", "map", input)).toBe("next-file");
    }
  });

  it("leaves browser shortcuts alone", () => {
    expect(press("k", "map", document.body, { metaKey: true })).toBeNull();
    expect(press("r", "map", document.body, { metaKey: true })).toBeNull();
    expect(press("c", "map", document.body, { ctrlKey: true })).toBeNull();
    expect(press("n", "map", document.body, { altKey: true })).toBeNull();
  });
});
