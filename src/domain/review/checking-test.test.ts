import { describe, expect, it } from "vitest";
import { hunk } from "../../application/testing/index.ts";
import { type Hunk, HunkId } from "../diff/index.ts";
import { type CheckingTest, checkingTestProblem, MAX_CHECKING_LINES } from "./index.ts";

const TEST_PATH = "src/routes/orders.test.ts";

const testHunk = hunk(TEST_PATH, "@@ -0,0 +1,11 @@", [
  '+describe("GET /orders/:id/receipt", () => {',
  '+  it("answers 404 for another user\'s order", async () => {',
  '+    const res = await get("/orders/o1/receipt", "ben");',
  "+    expect(res.status).toBe(404);",
  "+  });",
  "+",
  '+  it("rejects non-admin users from the export", async () => {',
  '+    const res = await get("/admin/customers.csv", "admin");',
  "+    // expect(res.status).toBe(403);",
  "+    void res;",
  "+  });",
]);
const codeHunk = hunk("src/routes/orders.ts", "@@ -1,1 +1,2 @@", [
  " const router = Router();",
  '+router.get("/orders/:id/receipt", receipt);',
]);
const helperHunk = hunk("tests/fake_keychain.py", "@@ -0,0 +1,2 @@", [
  "+def test_keychain_is_checked(store):",
  "+    store.write_text(secret)",
]);

const hunks = new Map<HunkId, Hunk>(
  [testHunk, codeHunk, helperHunk].map((one) => [one.id, one] as const),
);
const sent = new Set(hunks.keys());

const claim = (overrides: Partial<CheckingTest> = {}, lines = {}): CheckingTest => ({
  test: "answers 404 for another user's order",
  checks: "Another user's order gets 404.",
  ...overrides,
  lines: { hunkId: testHunk.id, side: "new", startLine: 4, line: 4, ...lines },
});

describe("checkingTestProblem", () => {
  it("keeps a test whose name is at or above lines of its hunk that assert", () => {
    expect(checkingTestProblem(claim(), hunks, sent)).toBeNull();
    expect(checkingTestProblem(claim({}, { startLine: 2, line: 5 }), hunks, sent)).toBeNull();
  });

  it("drops a hunk that isn't the PR's, or wasn't sent to the model in full", () => {
    const unknown = HunkId.parse("h_ffffffffffffffff");
    expect(checkingTestProblem(claim({}, { hunkId: unknown }), hunks, sent)).toBe("unknown-hunk");
    expect(checkingTestProblem(claim(), hunks, new Set([codeHunk.id]))).toBe("unknown-hunk");
  });

  it("drops code that isn't a test's, whatever its lines say", () => {
    const onCode = claim({ test: "router.get" }, { hunkId: codeHunk.id, startLine: 2, line: 2 });
    expect(checkingTestProblem(onCode, hunks, sent)).toBe("not-a-test");
  });

  it("drops lines the hunk doesn't show on the head side, or in the wrong order", () => {
    expect(checkingTestProblem(claim({}, { startLine: 4, line: 12 }), hunks, sent)).toBe(
      "lines-outside",
    );
    expect(checkingTestProblem(claim({}, { side: "old" }), hunks, sent)).toBe("lines-outside");
    expect(checkingTestProblem(claim({}, { startLine: 5, line: 4 }), hunks, sent)).toBe(
      "lines-outside",
    );
  });

  it("drops a claim on more lines than one test's assertions take", () => {
    const long = hunk(TEST_PATH, `@@ -0,0 +1,${MAX_CHECKING_LINES + 1} @@`, [
      '+it("checks everything", () => {',
      ...Array.from({ length: MAX_CHECKING_LINES }, () => "+  expect(a).toBe(b);"),
    ]);
    const all = new Map([...hunks, [long.id, long]]);
    const named = claim(
      { test: "checks everything" },
      { hunkId: long.id, startLine: 1, line: MAX_CHECKING_LINES + 1 },
    );
    expect(checkingTestProblem(named, all, new Set(all.keys()))).toBe("too-long");
  });

  it("drops a blank name or a blank account of what it checks", () => {
    expect(checkingTestProblem(claim({ test: " " }), hunks, sent)).toBe("blank");
    expect(checkingTestProblem(claim({ checks: "" }), hunks, sent)).toBe("blank");
  });

  describe("against a PR that dresses a test up as coverage", () => {
    it("drops a name that's only below the lines, in another test", () => {
      const borrowed = claim({ test: "rejects non-admin users from the export" });
      expect(checkingTestProblem(borrowed, hunks, sent)).toBe("name-not-shown");
    });

    it("drops a test whose only assertion is commented out", () => {
      const named = claim(
        { test: "rejects non-admin users from the export" },
        { startLine: 8, line: 10 },
      );
      expect(checkingTestProblem(named, hunks, sent)).toBe("no-assertion");
    });

    it("drops lines whose only assertion words are in a string or a trailing comment", () => {
      const dressed = hunk(TEST_PATH, "@@ -0,0 +1,3 @@", [
        '+it("should reject and expect a 403", async () => {',
        "+  await get(url); // expect(res.status).toBe(403)",
        "+});",
      ]);
      const all = new Map([[dressed.id, dressed]]);
      const named = claim(
        { test: "should reject and expect a 403" },
        { hunkId: dressed.id, startLine: 1, line: 3 },
      );
      expect(checkingTestProblem(named, all, new Set(all.keys()))).toBe("no-assertion");
    });

    it("drops a helper in a test directory that asserts nothing, though it's named as a test", () => {
      const named = claim(
        { test: "test_keychain_is_checked" },
        { hunkId: helperHunk.id, startLine: 1, line: 2 },
      );
      expect(checkingTestProblem(named, hunks, sent)).toBe("no-assertion");
    });
  });

  it("finds the name above the hunk in the test file's head content, when the PR changes an existing test", () => {
    const changed = hunk(TEST_PATH, "@@ -20,2 +20,2 @@", [
      "-    expect(res.status).toBe(200);",
      "+    expect(res.status).toBe(404);",
      "   });",
    ]);
    const all = new Map([...hunks, [changed.id, changed]]);
    const named = claim({}, { hunkId: changed.id, startLine: 20, line: 20 });
    const head = [
      ...Array.from({ length: 17 }, () => ""),
      '  it("answers 404 for another user\'s order", async () => {',
      "    const res = await get();",
      "    expect(res.status).toBe(404);",
      "  });",
    ].join("\n");
    expect(checkingTestProblem(named, all, new Set(all.keys()))).toBe("name-not-shown");
    expect(checkingTestProblem(named, all, new Set(all.keys()), head)).toBeNull();
    // Below the lines, the name is another test's.
    const below = [
      ...Array.from({ length: 22 }, () => ""),
      'it("answers 404 for another user\'s order"',
    ];
    expect(checkingTestProblem(named, all, new Set(all.keys()), below.join("\n"))).toBe(
      "name-not-shown",
    );
  });

  it.each([
    ["Python unittest", "test_x.py", "        self.assertEqual(response.status_code, 403)"],
    ["pytest", "test_x.py", "    assert response.status_code == 403"],
    ["pytest.raises", "test_x.py", "    with pytest.raises(Forbidden):"],
    ["Go", "x_test.go", '\t\tt.Errorf("got %d, want 403", got)'],
    ["Rust", "tests/x.rs", "    assert_eq!(status, 403);"],
    ["JUnit", "XTest.java", "    assertThat(status).isEqualTo(403);"],
    ["AVA", "test/x.ts", "\tt.is(status, 403);"],
    ["node:assert", "x.test.ts", "  assert.equal(status, 403);"],
  ])("takes a %s assertion", (_, path, line) => {
    const one = hunk(path, "@@ -0,0 +1,2 @@", ["+test_x", `+${line}`]);
    const all = new Map([[one.id, one]]);
    const named = claim({ test: "test_x" }, { hunkId: one.id, startLine: 2, line: 2 });
    expect(checkingTestProblem(named, all, new Set(all.keys()))).toBeNull();
  });
});
