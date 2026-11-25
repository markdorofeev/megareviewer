import { describe, expect, it } from "vitest";
import { refNames, withoutRefs } from "./guidance-refs.ts";
import { Guidance, PreferenceId } from "./preference.ts";

const preference = (ref: string) => ({
  ref,
  id: PreferenceId.parse("pref_0123456789abcdef"),
  kind: "look-for" as const,
  text: "Tenant isolation",
  scope: { kind: "global" as const },
});
const file = (ref: string, path: string) => ({ ref, path, bytes: 10 });
const guidance = Guidance.parse({
  preferences: [preference("p1"), preference("p2")],
  guidelines: [file("g1", "CLAUDE.md"), file("g3", "docs/handbook.md")],
});
const names = refNames(guidance, []);
const clean = (text: string) => withoutRefs(text, names).text;

describe("refNames", () => {
  it("has a file's path for each file's ref, and nothing for a preference's", () => {
    expect([...names]).toEqual([
      ["p1", null],
      ["p2", null],
      ["g1", "CLAUDE.md"],
      ["g3", "docs/handbook.md"],
    ]);
  });

  it("leaves out a ref the pull request's own text has as a word", () => {
    const code = ["const distance = (p1: Point) => p1.x;", "config.g3_enabled", "step3"];
    expect([...refNames(guidance, code).keys()]).toEqual(["p2", "g1", "g3"]);
  });

  it("is empty without guidance", () => {
    expect(refNames(null, ["p1"]).size).toBe(0);
    expect(refNames(Guidance.parse({ preferences: [], guidelines: [] }), ["p1"]).size).toBe(0);
  });
});

describe("withoutRefs", () => {
  it("puts a file's path in its ref's place, however the model wrote it", () => {
    expect(clean("Handbook (g3) says event names end in a version.")).toBe(
      "Handbook (docs/handbook.md) says event names end in a version.",
    );
    expect(clean("The handbook (g3, Events) says so.")).toBe(
      "The handbook (docs/handbook.md, Events) says so.",
    );
    expect(clean("Only IDs and times. [g3]")).toBe("Only IDs and times. [docs/handbook.md]");
    expect(clean("g1 asks for it, and `g3` too.")).toBe(
      "CLAUDE.md asks for it, and `docs/handbook.md` too.",
    );
  });

  it("drops a file's ref that comes right after its path", () => {
    expect(clean("See docs/handbook.md (g3) for events.")).toBe("See docs/handbook.md for events.");
    expect(clean("See `docs/handbook.md` [g3].")).toBe("See `docs/handbook.md`.");
  });

  it("drops a preference's ref, with the brackets and commas that were only for it", () => {
    expect(clean("A query without its tenant (p1).")).toBe("A query without its tenant.");
    expect(clean("A query without its tenant (p1, p2) runs.")).toBe(
      "A query without its tenant runs.",
    );
    expect(clean("Not recorded (p1 and p2), so nobody knows.")).toBe(
      "Not recorded, so nobody knows.",
    );
    expect(clean("Not recorded (p1, g3).")).toBe("Not recorded (docs/handbook.md).");
    expect(clean("Not recorded (g3, p1).")).toBe("Not recorded (docs/handbook.md).");
    expect(clean("Tenant isolation `p1` is lost.")).toBe("Tenant isolation is lost.");
    expect(clean("Not recorded, per p1, so nobody knows.")).toBe(
      "Not recorded, per, so nobody knows.",
    );
    expect(clean("p1: the tenant isn't checked")).toBe("the tenant isn't checked");
  });

  it("says which refs it found, each time", () => {
    expect(withoutRefs("By g3 and p1, and g3 again.", names).refs).toEqual(["g3", "p1", "g3"]);
  });

  it("leaves alone a ref-shaped word that isn't one of the run's refs", () => {
    for (const text of [
      "Upgrades to g2 and p9 plans.",
      "The p10 latency and the G3 engine.",
      "Reads `g2` first.",
    ]) {
      expect(withoutRefs(text, names)).toEqual({ text, refs: [] });
    }
  });

  it("leaves alone a ref that's part of a name, a path, a number or a longer code span", () => {
    for (const text of [
      "Sets flag_g3 and g3_enabled.",
      "Reads docs/g3/notes.md and src/p1.ts.",
      "Calls `distance(p1, p2)` twice.",
      "The log1 file and $p1.",
      "A g3-shaped key, and user.p1.",
    ]) {
      expect(withoutRefs(text, names)).toEqual({ text, refs: [] });
    }
  });

  it("keeps a text that would be left with nothing", () => {
    expect(withoutRefs("(p1)", names)).toEqual({ text: "(p1)", refs: [] });
  });

  it("changes nothing without names", () => {
    expect(withoutRefs("Handbook (g3).", new Map())).toEqual({ text: "Handbook (g3).", refs: [] });
  });
});
