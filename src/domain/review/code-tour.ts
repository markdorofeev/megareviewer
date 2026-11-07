import type { CallGraphHint, FileChange, HunkId } from "../diff/index.ts";
import type { RiskAssessment } from "./risk.ts";
import { isTestFile } from "./risk-rules.ts";
import { type Tour, type TourStep, TourStepId } from "./tour.ts";

/** Longest call chain a step's title shows, in symbols. */
const MAX_CHAIN = 3;
/** Directories and test files an explanation names before "and N more". */
const MAX_LISTED = 3;

// Repository paths are always "/"-separated.
const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const dirname = (path: string): string => path.slice(0, Math.max(path.lastIndexOf("/"), 0));
const stem = (name: string): string => {
  const dot = name.indexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
};
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The name a test file's subject has without its extension: foo.test.ts, test_foo.py → foo. */
const subjectStem = (path: string): string => {
  const name = basename(path);
  const base = stem(name);
  return base
    .replace(/^test_/i, "")
    .replace(/_(test|spec)$/i, "")
    .replace(/Tests?$/, "");
};

/** Leading directories two paths share. */
const sharedDepth = (a: string, b: string): number => {
  const left = dirname(a).split("/");
  const right = dirname(b).split("/");
  let depth = 0;
  while (depth < left.length && left[depth] === right[depth] && left[depth] !== "") depth += 1;
  return depth;
};

/** A file under review and the test and doc files that travel with it. */
interface Unit {
  readonly path: string;
  readonly files: readonly FileChange[];
  readonly hunkIds: readonly HunkId[];
  readonly contract: number;
}

const requiredHunks = (file: FileChange, required: ReadonlySet<HunkId>): HunkId[] =>
  file.hunks.map((hunk) => hunk.id).filter((id) => required.has(id));

/**
 * Groups changed files into units: each test file joins the changed file it tests, and a doc
 * joins the code in its directory when there's exactly one. The subject is the file with the
 * test's name, sharing the most directories with it, so __tests__/foo.ts finds ../foo.ts and
 * src/test/FooTest.java finds src/main/Foo.java.
 */
const buildUnits = (
  files: readonly FileChange[],
  required: ReadonlySet<HunkId>,
  isContract: (id: HunkId) => boolean,
): Unit[] => {
  const changed = files.filter((file) => requiredHunks(file, required).length > 0);
  const isDoc = (file: FileChange) => /\.(md|mdx|rst|adoc)$/i.test(file.path);
  const subjects = changed.filter((file) => !isTestFile(file.path) && !isDoc(file));
  const members = new Map<string, FileChange[]>(subjects.map((file) => [file.path, [file]]));
  const join = (owner: FileChange | undefined, file: FileChange) => {
    const list = owner === undefined ? undefined : members.get(owner.path);
    if (list === undefined) members.set(file.path, [file]);
    else list.push(file);
  };

  for (const test of changed.filter((file) => isTestFile(file.path) && !isDoc(file))) {
    const name = subjectStem(test.path);
    const subject = subjects
      .filter((file) => stem(basename(file.path)) === name)
      .sort(
        (a, b) =>
          sharedDepth(b.path, test.path) - sharedDepth(a.path, test.path) ||
          compare(a.path, b.path),
      )[0];
    join(subject, test);
  }
  for (const doc of changed.filter(isDoc)) {
    const neighbours = subjects.filter((file) => dirname(file.path) === dirname(doc.path));
    join(neighbours.length === 1 ? neighbours[0] : undefined, doc);
  }

  return [...members].map(([path, list]): Unit => {
    const hunkIds = list.flatMap((file) => requiredHunks(file, required));
    return { path, files: list, hunkIds, contract: hunkIds.filter(isContract).length };
  });
};

/** Riskier first, then by path. */
const byRisk = (a: Unit, b: Unit): number => b.contract - a.contract || compare(a.path, b.path);

/** Up to three leading directories: the step a lone file is grouped into. */
const area = (path: string): string => dirname(path).split("/").slice(0, 3).join("/");

const listed = (items: readonly string[]): string => {
  const shown = items.slice(0, MAX_LISTED);
  const rest = items.length - shown.length;
  const head = rest > 0 ? [...shown, `${rest} more`] : shown;
  return head.length <= 1 ? head.join("") : `${head.slice(0, -1).join(", ")} and ${head.at(-1)}`;
};

const explain = (units: readonly Unit[]): string => {
  const files = units.flatMap((unit) => unit.files);
  const areas = [...new Set(files.map((file) => dirname(file.path) || "the repository root"))];
  const tests = files.filter((file) => isTestFile(file.path)).map((file) => basename(file.path));
  const count = files.length === 1 ? "1 file" : `${files.length} files`;
  const where = `${count} in ${listed(areas)}`;
  return tests.length === 0 ? `${where}.` : `${where}, tested in ${listed(tests)}.`;
};

/**
 * The tour without the model, from the call-graph hints. Changed files form units (a file with
 * its tests); a unit points to another when one of its hunks references a symbol the other
 * changes. Each connected group of units is a step, read from its entry points (units nothing
 * in the group calls), callers before callees. Units with no links are grouped by directory.
 * Steps with contract hunks come first. Every required hunk is in exactly one step.
 */
export interface CodeTourInput {
  readonly files: readonly FileChange[];
  /** Hunks without a mechanical proof: every one is in exactly one step. */
  readonly required: ReadonlySet<HunkId>;
  readonly callGraph: readonly CallGraphHint[];
  readonly risk: readonly RiskAssessment[];
  /** Each hunk's changed definitions, innermost, by name. */
  readonly definitions: ReadonlyMap<HunkId, readonly string[]>;
}

export const codeTour = ({
  files,
  required: requiredHunkIds,
  callGraph,
  risk,
}: CodeTourInput): Tour => {
  const contract = new Set(
    risk.flatMap((assessment) => (assessment.riskClass === "contract" ? [assessment.hunkId] : [])),
  );
  const units = buildUnits(files, requiredHunkIds, (id) => contract.has(id));
  const unitOf = new Map(units.flatMap((unit) => unit.hunkIds.map((id) => [id, unit] as const)));

  // Edges between units, each with the symbol it was found by (the first by name).
  const callees = new Map<Unit, Map<Unit, string>>(units.map((unit) => [unit, new Map()]));
  const callers = new Map<Unit, Set<Unit>>(units.map((unit) => [unit, new Set()]));
  for (const hint of callGraph.filter((one) => one.use === "call")) {
    const from = unitOf.get(hint.fromHunkId);
    const to = unitOf.get(hint.toHunkId);
    if (from === undefined || to === undefined || from === to) continue;
    const edges = callees.get(from);
    const symbol = edges?.get(to);
    if (symbol === undefined || hint.symbol < symbol) edges?.set(to, hint.symbol);
    callers.get(to)?.add(from);
  }
  const calleesOf = (unit: Unit): Unit[] => [...(callees.get(unit)?.keys() ?? [])].sort(byRisk);
  const linked = (unit: Unit) =>
    (callees.get(unit)?.size ?? 0) > 0 || (callers.get(unit)?.size ?? 0) > 0;

  // Connected groups, each in reading order: entry points first, then depth first along calls.
  const visited = new Set<Unit>();
  const groups: Unit[][] = [];
  const connected = units.filter(linked);
  const groupOf = new Map<Unit, number>();
  for (const start of [...connected].sort(byRisk)) {
    if (groupOf.has(start)) continue;
    const index = groups.length;
    const queue = [start];
    for (let unit = queue.pop(); unit !== undefined; unit = queue.pop()) {
      if (groupOf.has(unit)) continue;
      groupOf.set(unit, index);
      queue.push(...(callees.get(unit)?.keys() ?? []), ...(callers.get(unit) ?? []));
    }
    const members = connected.filter((unit) => groupOf.get(unit) === index);
    const order: Unit[] = [];
    const visit = (unit: Unit) => {
      if (visited.has(unit)) return;
      visited.add(unit);
      order.push(unit);
      for (const callee of calleesOf(unit)) visit(callee);
    };
    while (order.length < members.length) {
      const left = members.filter((unit) => !visited.has(unit));
      // An entry point has no caller left to read; in a cycle, start at its riskiest unit.
      const entries = left.filter(
        (unit) => ![...(callers.get(unit) ?? [])].some((caller) => !visited.has(caller)),
      );
      const next = (entries.length > 0 ? entries : left).sort(byRisk)[0];
      if (next === undefined) break;
      visit(next);
    }
    groups.push(order);
  }

  const areas = new Map<string, Unit[]>();
  for (const unit of units.filter((one) => !linked(one))) {
    const key = area(unit.path);
    areas.set(key, [...(areas.get(key) ?? []), unit].sort(byRisk));
  }

  const chainTitle = (group: readonly Unit[]): string => {
    let best: string[] = [];
    const walk = (unit: Unit, symbols: readonly string[], seen: ReadonlySet<Unit>) => {
      if (symbols.length > best.length) best = [...symbols];
      if (symbols.length === MAX_CHAIN) return;
      for (const callee of calleesOf(unit)) {
        const symbol = callees.get(unit)?.get(callee);
        if (symbol !== undefined && !seen.has(callee)) {
          walk(callee, [...symbols, symbol], new Set([...seen, callee]));
        }
      }
    };
    for (const unit of group) walk(unit, [], new Set([unit]));
    const chain = best.join(" → ");
    const rest = group.length - (best.length + 1);
    return rest > 0 ? `${chain} and ${rest} more` : chain;
  };

  const steps = [
    ...groups.map((group) => ({ units: group, title: chainTitle(group) })),
    ...[...areas].map(([key, group]) => ({
      units: group,
      title: group.length === 1 ? (group[0]?.path ?? key) : key || "Repository root",
    })),
  ];
  const contractCount = (step: { readonly units: readonly Unit[] }) =>
    step.units.reduce((sum, unit) => sum + unit.contract, 0);
  const firstPath = (step: { readonly units: readonly Unit[] }) => step.units[0]?.path ?? "";

  return {
    steps: steps
      .sort((a, b) => contractCount(b) - contractCount(a) || compare(firstPath(a), firstPath(b)))
      .map(
        (step, index): TourStep => ({
          id: TourStepId.parse(`s${index + 1}`),
          title: step.title,
          explanation: explain(step.units),
          hunkIds: step.units.flatMap((unit) => unit.hunkIds),
          kind: "flow",
          via: [],
        }),
      ),
    builtBy: "code",
  };
};
