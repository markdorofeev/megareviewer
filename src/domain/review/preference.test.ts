import { describe, expect, it } from "vitest";
import { HunkId } from "../diff/index.ts";
import {
  AnalysisId,
  CommentKey,
  canEnable,
  checkGuidanceMark,
  Guidance,
  guidanceOf,
  guidelineEnabled,
  guidelineFile,
  inCreationOrder,
  MAX_ENABLED_PREFERENCES,
  MAX_INLINE_BYTES,
  mergeEvidence,
  type PastComment,
  PointId,
  Preference,
  PreferenceId,
  PreferenceProposal,
  PreferenceScope,
  pointSignalKey,
  postedSignalKey,
  preferenceId,
  preferencesFor,
  proposalId,
  publishedSignalKey,
  type RepoRef,
  type ReviewSignal,
  resolveGuidanceMark,
  sameRule,
  sameScope,
} from "./index.ts";

const shop: RepoRef = { host: "github", owner: "acme", repo: "shop" };
const api: RepoRef = { host: "github", owner: "acme", repo: "api" };

let made = 0;
const preference = (overrides: Partial<Preference> = {}): Preference => {
  made += 1;
  return {
    id: PreferenceId.parse(`pref_${made.toString(16).padStart(16, "0")}`),
    kind: "look-for",
    text: "Tenant isolation",
    scope: { kind: "global" },
    source: "written",
    enabled: true,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    ...overrides,
  };
};

describe("Preference", () => {
  it("trims its text, and refuses an empty one or one over 300 characters", () => {
    const parsed = Preference.parse({ ...preference(), text: "  Naming  " });
    expect(parsed.text).toBe("Naming");
    expect(Preference.safeParse({ ...preference(), text: "   " }).success).toBe(false);
    expect(Preference.safeParse({ ...preference(), text: "x".repeat(300) }).success).toBe(true);
    expect(Preference.safeParse({ ...preference(), text: "x".repeat(301) }).success).toBe(false);
  });

  it("is for every repository or for one", () => {
    expect(PreferenceScope.parse({ kind: "repo", repo: shop })).toEqual({
      kind: "repo",
      repo: shop,
    });
    expect(PreferenceScope.safeParse({ kind: "repo" }).success).toBe(false);
    expect(PreferenceScope.safeParse({ kind: "team" }).success).toBe(false);
  });
});

describe("PreferenceProposal", () => {
  const proposal = {
    id: "prop_00000000000000b1",
    kind: "dont-flag",
    text: "Naming",
    scope: { kind: "global" },
    source: "learned",
    evidence: [],
    status: "pending",
    createdAt: "2026-11-02T10:00:00.000Z",
  };

  it("keeps a text longer than a preference's, since a model wrote it", () => {
    expect(PreferenceProposal.safeParse({ ...proposal, text: "x".repeat(400) }).success).toBe(true);
  });

  it("refuses more than 5 lines of evidence, and a source the reviewer writes", () => {
    const lines = ["1", "2", "3", "4", "5", "6"];
    expect(PreferenceProposal.safeParse({ ...proposal, evidence: lines }).success).toBe(false);
    expect(PreferenceProposal.safeParse({ ...proposal, source: "written" }).success).toBe(false);
  });
});

describe("preferencesFor", () => {
  it("reads the enabled ones, everywhere's first, then the repository's, each as made", () => {
    const late = preference({ text: "late", createdAt: "2026-11-03T10:00:00.000Z" });
    const early = preference({ text: "early", createdAt: "2026-11-01T09:00:00.000Z" });
    const off = preference({ text: "off", enabled: false });
    const ours = preference({ text: "ours", scope: { kind: "repo", repo: shop } });
    const oursLater = preference({
      text: "ours later",
      scope: { kind: "repo", repo: shop },
      createdAt: "2026-11-04T10:00:00.000Z",
    });
    const theirs = preference({ text: "theirs", scope: { kind: "repo", repo: api } });
    const otherHost = preference({
      text: "other host",
      scope: { kind: "repo", repo: { ...shop, host: "bitbucket" } },
    });

    const read = preferencesFor([oursLater, late, theirs, off, ours, otherHost, early], shop);

    expect(read.map((one) => one.text)).toEqual(["early", "late", "ours", "ours later"]);
  });

  it("keeps two made at the same time in the order given", () => {
    const a = preference({ text: "a" });
    const b = preference({ text: "b" });
    const earlier = preference({ text: "earlier", createdAt: "2026-10-01T10:00:00.000Z" });
    expect(inCreationOrder([b, a, earlier])).toEqual([earlier, b, a]);
    expect(inCreationOrder([a, earlier, b])).toEqual([earlier, a, b]);
  });
});

describe("canEnable", () => {
  const full = Array.from({ length: MAX_ENABLED_PREFERENCES }, () => preference());

  it("refuses one more than 50 enabled in a scope", () => {
    expect(canEnable(full.slice(1), { kind: "global" })).toBe(true);
    expect(canEnable(full, { kind: "global" })).toBe(false);
  });

  it("counts each repository apart from everywhere and from the others", () => {
    expect(canEnable(full, { kind: "repo", repo: shop })).toBe(true);
    const ours = full.map((one) => ({ ...one, scope: { kind: "repo" as const, repo: shop } }));
    expect(canEnable(ours, { kind: "repo", repo: shop })).toBe(false);
    expect(canEnable(ours, { kind: "repo", repo: api })).toBe(true);
    expect(sameScope({ kind: "repo", repo: shop }, { kind: "repo", repo: { ...shop } })).toBe(true);
  });

  it("leaves out the disabled ones and the one being changed", () => {
    const [first] = full;
    if (first === undefined) throw new Error("built with 50");
    expect(canEnable(full, { kind: "global" }, first.id)).toBe(true);
    expect(canEnable([...full.slice(1), { ...first, enabled: false }], { kind: "global" })).toBe(
      true,
    );
  });
});

describe("guideline files", () => {
  it("reads REVIEW.md unless it's switched off, and the others only when switched on", () => {
    expect(guidelineEnabled("REVIEW.md", new Map())).toBe(true);
    expect(guidelineEnabled("REVIEW.md", new Map([["REVIEW.md", false]]))).toBe(false);
    expect(guidelineEnabled("CLAUDE.md", new Map())).toBe(false);
    expect(guidelineEnabled("CLAUDE.md", new Map([["CLAUDE.md", true]]))).toBe(true);
  });

  it("measures a file in bytes, and marks one over 64 KB too large", () => {
    expect(guidelineFile("REVIEW.md", "é", new Map())).toEqual({
      path: "REVIEW.md",
      bytes: 2,
      enabled: true,
      tooLarge: false,
    });
    const atLimit = guidelineFile("AGENTS.md", "x".repeat(MAX_INLINE_BYTES), new Map());
    expect(atLimit).toMatchObject({ bytes: 65_536, enabled: false, tooLarge: false });
    const over = guidelineFile(
      "CLAUDE.md",
      "x".repeat(MAX_INLINE_BYTES + 1),
      new Map([["CLAUDE.md", true]]),
    );
    expect(over).toMatchObject({ enabled: true, tooLarge: true });
  });
});

const lookFor = preference({ text: "Tenant isolation" });
const dontFlag = preference({
  kind: "dont-flag",
  text: "Naming",
  scope: { kind: "repo", repo: shop },
});
const guidance: Guidance = guidanceOf(
  [lookFor, dontFlag],
  [{ path: "REVIEW.md", bytes: 120, linkedFrom: null, given: "prompt" }],
);

describe("guidanceOf", () => {
  it("numbers the preferences from p1 and the guideline files from g1, in the order sent", () => {
    expect(guidance).toEqual({
      preferences: [
        {
          ref: "p1",
          id: lookFor.id,
          kind: "look-for",
          text: "Tenant isolation",
          scope: lookFor.scope,
        },
        { ref: "p2", id: dontFlag.id, kind: "dont-flag", text: "Naming", scope: dontFlag.scope },
      ],
      guidelines: [{ ref: "g1", path: "REVIEW.md", linkedFrom: null, given: "prompt", bytes: 120 }],
      checks: [],
    });
  });
});

describe("Guidance", () => {
  it("parses one stored before files were linked, every file a root", () => {
    const stored = {
      preferences: [],
      guidelines: [{ ref: "g1", path: "REVIEW.md", bytes: 120 }],
    };
    expect(Guidance.parse(stored).guidelines).toEqual([
      { ref: "g1", path: "REVIEW.md", bytes: 120, linkedFrom: null, given: "prompt" },
    ]);
  });
});

describe("checkGuidanceMark", () => {
  it("keeps a mark whose preference could have that effect", () => {
    expect(checkGuidanceMark({ ref: "p1", effect: "raised" }, guidance)).toEqual({
      ref: "p1",
      effect: "raised",
    });
    expect(checkGuidanceMark({ ref: "p2", effect: "left-out" }, guidance)).toEqual({
      ref: "p2",
      effect: "left-out",
    });
  });

  it("drops left-out by a look-for preference and raised by a dont-flag one", () => {
    expect(checkGuidanceMark({ ref: "p1", effect: "left-out" }, guidance)).toBeNull();
    expect(checkGuidanceMark({ ref: "p2", effect: "raised" }, guidance)).toBeNull();
  });

  it("takes either effect from a guideline file", () => {
    expect(checkGuidanceMark({ ref: "g1", effect: "raised" }, guidance)).not.toBeNull();
    expect(checkGuidanceMark({ ref: "g1", effect: "left-out" }, guidance)).not.toBeNull();
  });

  it("takes a mark on a file a guideline file imports, and names that file", () => {
    const linked = guidanceOf(
      [],
      [
        { path: "CLAUDE.md", bytes: 40, linkedFrom: null, given: "prompt" },
        { path: "ENGINEERING.md", bytes: 900, linkedFrom: "CLAUDE.md", given: "prompt" },
      ],
    );
    const mark = { ref: "g2", effect: "raised" } as const;
    expect(checkGuidanceMark(mark, linked)).toEqual(mark);
    expect(resolveGuidanceMark(mark, linked)).toEqual({
      effect: "raised",
      label: "ENGINEERING.md",
      preferenceId: null,
    });
  });

  it("drops a ref the run didn't have, and every mark of a run without guidance", () => {
    expect(checkGuidanceMark({ ref: "p3", effect: "raised" }, guidance)).toBeNull();
    expect(checkGuidanceMark({ ref: "g2", effect: "raised" }, guidance)).toBeNull();
    expect(checkGuidanceMark({ ref: "p1", effect: "raised" }, null)).toBeNull();
    expect(checkGuidanceMark(null, guidance)).toBeNull();
  });
});

describe("resolveGuidanceMark", () => {
  it("names a preference by its text and a guideline file by its path", () => {
    expect(resolveGuidanceMark({ ref: "p2", effect: "left-out" }, guidance)).toEqual({
      effect: "left-out",
      label: "Naming",
      preferenceId: dontFlag.id,
    });
    expect(resolveGuidanceMark({ ref: "g1", effect: "raised" }, guidance)).toEqual({
      effect: "raised",
      label: "REVIEW.md",
      preferenceId: null,
    });
  });
});

describe("mergeEvidence", () => {
  const at = "2026-11-03T10:00:00.000Z";
  const signal = (
    kind: ReviewSignal["kind"],
    text: string,
    number = 12,
    repo: RepoRef = shop,
  ): ReviewSignal => ({
    kind,
    at,
    pullRequest: { repo, number },
    pointKind: kind === "comment" ? null : "finding",
    title: kind === "comment" ? "" : text,
    text,
    path: "src/cart.ts",
  });
  const comment = (body: string, number = 12, repo: RepoRef = shop): PastComment => ({
    pullRequest: { repo, number },
    path: "src/cart.ts",
    body,
    at,
  });

  it("sends a comment posted from here once, as the host has it", () => {
    const merged = mergeEvidence(
      [signal("comment", "What invalidates   this?")],
      [comment("What invalidates this?")],
    );
    expect(merged).toEqual({ signals: [], comments: [comment("What invalidates this?")] });
  });

  it("reads Bitbucket's escaped punctuation as the words posted", () => {
    const merged = mergeEvidence(
      [signal("comment", "Name it `MAX_RETRIES` (maybe)")],
      [comment("Name it `MAX\\_RETRIES` \\(maybe\\)")],
    );
    expect(merged.signals).toEqual([]);
  });

  it("keeps a comment signal whose pull request the host read didn't reach", () => {
    const old = signal("comment", "What invalidates this?", 3);
    expect(mergeEvidence([old], [comment("What invalidates this?", 12)]).signals).toEqual([old]);
  });

  it("keeps the same words on two pull requests, since repetition is what a rule rests on", () => {
    const twice = [comment("Add a test for this", 12), comment("Add a test for this", 13)];
    expect(mergeEvidence([], twice).comments).toEqual(twice);
    const elsewhere = {
      ...comment("Add a test for this", 12),
      pullRequest: { repo: api, number: 12 },
    };
    expect(mergeEvidence([], [comment("Add a test for this"), elsewhere]).comments).toHaveLength(2);
  });

  it("sends the host's repeat of a comment on one pull request once", () => {
    expect(
      mergeEvidence([], [comment("Add a test for this"), comment(" Add a test  for this")])
        .comments,
    ).toEqual([comment("Add a test for this")]);
  });

  it("never takes a dismissed or raised point for a repeat", () => {
    const points = [
      signal("dismissed", "Add a test for this"),
      signal("raised", "Add a test for this"),
      signal("dismissed", "Add a test for this"),
    ];
    expect(mergeEvidence(points, [comment("Add a test for this")]).signals).toEqual(points);
  });
});

describe("sameRule", () => {
  it("is the same kind saying the same words, whatever their case and spacing", () => {
    expect(
      sameRule(
        { kind: "dont-flag", text: " Naming  of helpers" },
        { kind: "dont-flag", text: "naming of Helpers" },
      ),
    ).toBe(true);
    expect(
      sameRule({ kind: "dont-flag", text: "Naming" }, { kind: "look-for", text: "Naming" }),
    ).toBe(false);
    expect(
      sameRule({ kind: "dont-flag", text: "Naming" }, { kind: "dont-flag", text: "Names" }),
    ).toBe(false);
  });
});

describe("preferenceId and proposalId", () => {
  const seed = {
    kind: "look-for" as const,
    text: "Tenant isolation",
    scope: { kind: "repo" as const, repo: shop },
    createdAt: "2026-11-01T10:00:00.000Z",
  };

  it("names a preference by what it says and when, the same every time", () => {
    const id = preferenceId(seed, new Set());
    expect(id).toMatch(/^pref_[0-9a-f]{16}$/);
    expect(preferenceId(seed, new Set())).toBe(id);
    expect(preferenceId({ ...seed, text: "Naming" }, new Set())).not.toBe(id);
    expect(preferenceId({ ...seed, scope: { kind: "global" } }, new Set())).not.toBe(id);
    expect(proposalId(seed, new Set())).toMatch(/^prop_[0-9a-f]{16}$/);
  });

  it("takes another id when the first is in use", () => {
    const first = preferenceId(seed, new Set());
    const second = preferenceId(seed, new Set([first]));
    expect(second).not.toBe(first);
    expect(preferenceId(seed, new Set([first, second]))).not.toBe(second);
  });
});

describe("signal keys", () => {
  const id = AnalysisId.parse("a_0123456789abcdef");
  const comment = CommentKey.parse("hunk:h_0123456789abcdef:new:14");

  it("key a point's signal by its analysis and point", () => {
    expect(pointSignalKey(id, PointId.parse("f1"))).toBe("point:a_0123456789abcdef:f1");
  });

  it("key a review's comment by its analysis, the review's number and the comment", () => {
    expect(publishedSignalKey(id, 2, comment)).toBe(
      "review:a_0123456789abcdef:2:hunk:h_0123456789abcdef:new:14",
    );
  });

  it("key a comment posted now by when it was posted, so two on a line are two signals", () => {
    const on = { hunkId: HunkId.parse("h_0123456789abcdef"), side: "new", line: 14 } as const;
    const first = postedSignalKey(id, "2026-11-01T10:00:00.000Z", on);
    expect(first).toBe("now:a_0123456789abcdef:2026-11-01T10:00:00.000Z:h_0123456789abcdef:new:14");
    expect(postedSignalKey(id, "2026-11-01T10:00:01.000Z", on)).not.toBe(first);
  });
});
