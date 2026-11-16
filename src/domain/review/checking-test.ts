import { z } from "zod";
import { type Hunk, type HunkId, hunkHasLine, isTestFile } from "../diff/index.ts";
import { PointLines } from "./point-lines.ts";

/**
 * A test in the PR whose assertions check the very behavior a risk names, as the model named it
 * and the server checked it: a mark on the risk, never a reason to show it less.
 */
export const CheckingTest = z
  .object({
    /** As the test's code writes it: a function's name, or the string a test case is given. */
    test: z.string().min(1),
    /** Head-side lines of a test's hunk: its assertions about the risk's behavior. */
    lines: PointLines,
    /** What those assertions check, in the model's words. */
    checks: z.string(),
  })
  .readonly();
export type CheckingTest = z.infer<typeof CheckingTest>;

/** What can be wrong with a checking test the model named; each costs the risk its mark. */
export type CheckingTestProblem =
  /** Not a hunk sent to the model in full, so it couldn't have read it. */
  | "unknown-hunk"
  | "not-a-test"
  | "lines-outside"
  | "too-long"
  /** Its name isn't at or above the lines, in the hunk or in the test file's head content. */
  | "name-not-shown"
  | "no-assertion"
  | "blank";

/** The most lines one test's assertions take: a claim on more names a file, not a test. */
export const MAX_CHECKING_LINES = 40;

// Assertion words of the common test libraries: assert*, expect, should, t.is and the like, Go's
// t.Error and t.Fatal, pytest.raises. Only a gate: it can take the mark away, never give it.
const ASSERTION =
  /(?<![\w$])(assert\w*|expect\w*|should\w*|verify\w*|refute\w*|raises|throws\w*|rejects\w*|require\.\w+|t\.(?:is|not|true|false|truthy|falsy|deepEqual|notDeepEqual|like|regex|snapshot|fail|Errorf?|Fatalf?)|self\.fail)(?![\w$])/;
const COMMENT = /^\s*(\/\/|#|\/?\*|--)/;
// Strings and trailing comments go first, so a test named "rejects non-admins" or a line ending
// "// expect(403)" doesn't pass for an assertion.
const STRING = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const TRAILING_COMMENT = /\s(\/\/|#).*$/;

const asserts = (text: string): boolean =>
  !COMMENT.test(text) && ASSERTION.test(text.replace(STRING, '""').replace(TRAILING_COMMENT, ""));

/**
 * Why the server can't keep a checking test the model named for a risk, or null when it can: the
 * hunk was sent in full and is a test's, shows the lines on the head side, the test's name is at
 * or above them, and the lines, at most MAX_CHECKING_LINES of them, hold an assertion outside a
 * comment. The name may be above the hunk, in the head content the model read with it, when the
 * PR changes an existing test's assertions. Whether the assertion is about the risk only the
 * model can say; everything else is checked here, since a wrong mark tells the reviewer to relax.
 */
export const checkingTestProblem = (
  claim: CheckingTest,
  hunks: ReadonlyMap<HunkId, Hunk>,
  sentInFull: ReadonlySet<HunkId>,
  headContent: string | null = null,
): CheckingTestProblem | null => {
  const { hunkId, side, startLine, line } = claim.lines;
  const hunk = hunks.get(hunkId);
  if (hunk === undefined || !sentInFull.has(hunkId)) return "unknown-hunk";
  if (!isTestFile(hunk.path)) return "not-a-test";
  if (claim.test.trim() === "" || claim.checks.trim() === "") return "blank";
  if (
    side !== "new" ||
    startLine > line ||
    !hunkHasLine(hunk, side, startLine) ||
    !hunkHasLine(hunk, side, line)
  ) {
    return "lines-outside";
  }
  if (line - startLine + 1 > MAX_CHECKING_LINES) return "too-long";
  const shown = hunk.lines.filter((diffLine) => diffLine.kind !== "del");
  const named =
    shown.some(
      (diffLine) => (diffLine.newLine ?? 0) <= line && diffLine.text.includes(claim.test),
    ) ||
    (headContent
      ?.split("\n")
      .slice(0, line)
      .some((text) => text.includes(claim.test)) ??
      false);
  if (!named) return "name-not-shown";
  const asserted = shown.some(
    (diffLine) =>
      (diffLine.newLine ?? 0) >= startLine &&
      (diffLine.newLine ?? 0) <= line &&
      asserts(diffLine.text),
  );
  return asserted ? null : "no-assertion";
};
