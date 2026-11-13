import { describe, expect, it } from "vitest";
import { chordKeys, isTextEntry, KEYMAP, shortcut, shortcutFor } from "./keymap.ts";

const press = (
  key: string,
  modifiers: { shift?: boolean; meta?: boolean; ctrl?: boolean; alt?: boolean } = {},
  target: EventTarget | null = document.body,
) => ({
  key,
  shiftKey: modifiers.shift ?? false,
  metaKey: modifiers.meta ?? false,
  ctrlKey: modifiers.ctrl ?? false,
  altKey: modifiers.alt ?? false,
  target,
});

const ALL = KEYMAP.map((entry) => entry.id);
const ON = { mac: true, singleKeys: true };

describe("shortcutFor", () => {
  it("finds the shortcut a key runs", () => {
    expect(shortcutFor(press("n"), ALL, ON)).toBe("nextFile");
    expect(shortcutFor(press("ArrowDown"), ALL, ON)).toBe("lineDown");
    expect(shortcutFor(press("ArrowDown", { shift: true }), ALL, ON)).toBe("extendDown");
    expect(shortcutFor(press("R", { shift: true }), ALL, ON)).toBe("openReview");
    expect(shortcutFor(press("?", { shift: true }), ALL, ON)).toBe("help");
  });

  it("keeps a modifier's key for the browser", () => {
    expect(shortcutFor(press("n", { meta: true }), ALL, ON)).toBeNull();
    expect(shortcutFor(press("n", { alt: true }), ALL, ON)).toBeNull();
  });

  it("uses ⌘ on macOS and Ctrl elsewhere", () => {
    expect(shortcutFor(press("Enter", { meta: true }), ALL, ON)).toBe("submit");
    expect(shortcutFor(press("Enter", { ctrl: true }), ALL, ON)).toBeNull();
    expect(shortcutFor(press("Enter", { ctrl: true }), ALL, { ...ON, mac: false })).toBe("submit");
  });

  it("lets keys type into fields, but not ⌘↵ or Esc", () => {
    const field = document.createElement("textarea");
    expect(shortcutFor(press("n", {}, field), ALL, ON)).toBeNull();
    expect(shortcutFor(press("ArrowDown", {}, field), ALL, ON)).toBeNull();
    expect(shortcutFor(press("Enter", { meta: true }, field), ALL, ON)).toBe("submit");
    expect(shortcutFor(press("Escape", {}, field), ALL, ON)).toBe("close");
  });

  it("turns single keys off and leaves the others on", () => {
    const off = { mac: true, singleKeys: false };
    expect(shortcutFor(press("n"), ALL, off)).toBeNull();
    expect(shortcutFor(press("R", { shift: true }), ALL, off)).toBeNull();
    // Arrow keys aren't characters, so they stay on.
    expect(shortcutFor(press("ArrowDown"), ALL, off)).toBe("lineDown");
    expect(shortcutFor(press("Enter", { meta: true }), ALL, off)).toBe("submit");
    expect(shortcutFor(press("Escape"), ALL, off)).toBe("close");
  });

  it("gives . to the next point, and turns it off with the other single keys", () => {
    expect(shortcutFor(press("."), ["nextPoint"], ON)).toBe("nextPoint");
    expect(shortcutFor(press("."), ["nextPoint"], { mac: true, singleKeys: false })).toBeNull();
  });

  it("only runs the shortcuts asked for", () => {
    expect(shortcutFor(press("n"), ["help"], ON)).toBeNull();
  });
});

describe("isTextEntry", () => {
  it("counts text fields and editable content, not checkboxes or buttons", () => {
    const text = document.createElement("input");
    const box = document.createElement("input");
    box.type = "checkbox";
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    expect(isTextEntry(text)).toBe(true);
    expect(isTextEntry(box)).toBe(false);
    expect(isTextEntry(document.createElement("button"))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});

describe("chordKeys", () => {
  it("shows each key of a chord", () => {
    expect(chordKeys(shortcut("submit").chords[0] ?? { key: "" }, true)).toEqual(["⌘", "↵"]);
    expect(chordKeys(shortcut("submit").chords[0] ?? { key: "" }, false)).toEqual(["Ctrl", "↵"]);
    expect(chordKeys(shortcut("openReview").chords[0] ?? { key: "" }, true)).toEqual(["⇧", "R"]);
    expect(chordKeys(shortcut("help").chords[0] ?? { key: "" }, true)).toEqual(["?"]);
    expect(chordKeys(shortcut("extendUp").chords[0] ?? { key: "" }, true)).toEqual(["⇧", "↑"]);
  });

  it("gives every shortcut a distinct chord within where it works", () => {
    const seen = KEYMAP.flatMap((entry) =>
      entry.chords.map(
        (chord) => `${entry.scope} ${chord.mod ?? false} ${chord.shift ?? false} ${chord.key}`,
      ),
    );
    expect(new Set(seen).size).toBe(seen.length);
  });
});
