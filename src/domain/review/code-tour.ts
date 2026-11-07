import { type CallGraphHint, type FileChange, type HunkId, isTestFile } from "../diff/index.ts";
import { type Entry, entryLabel, entryOf } from "./entry-points.ts";
import type { RiskAssessment } from "./risk.ts";
import { type Tour, type TourStep, TourStepId } from "./tour.ts";

export interface CodeTourInput {
  readonly files: readonly FileChange[];
  /** Hunks without a mechanical proof: every one is in exactly one step. */
  readonly required: ReadonlySet<HunkId>;
  readonly callGraph: readonly CallGraphHint[];
  readonly risk: readonly RiskAssessment[];
  /** Each hunk's changed definitions, innermost, by name. */
  readonly definitions: ReadonlyMap<HunkId, readonly string[]>;
  /** Paths whose first lines say a tool wrote them. They're grouped, never hidden. */
  readonly generated?: ReadonlySet<string>;
}

/** Directories and files an explanation names before "and N more". */
const MAX_LISTED = 3;

// Repository paths are always "/"-separated.
const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const dirname = (path: string): string => path.slice(0, Math.max(path.lastIndexOf("/"), 0));
const stem = (name: string): string => {
  const dot = name.indexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
};
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const isDoc = (path: string): boolean => /\.(md|mdx|rst|adoc)$/i.test(path);
const isSchema = (path: string): boolean =>
  /^(openapi|swagger)\b/i.test(basename(path)) ||
  /\.(graphql|gql|proto|avsc|prisma)$/i.test(path) ||
  /\.schema\.json$/i.test(path);

/** Whether a file's first lines say a tool wrote it. A grouping hint, never a mechanical proof. */
export const looksGenerated = (content: string): boolean =>
  /@generated\b|auto-?generated|code generated|do not edit/i.test(
    content.split("\n").slice(0, 5).join("\n"),
  );

/** The names a test or a test helper points at: foo.test.ts, test_foo.py, fake_foo.py → foo. */
const subjectNames = (path: string): string[] => {
  const name = basename(path);
  const base = stem(name);
  const marked = /\.(test|spec)\./i.test(name);
  const names = [
    base
      .replace(/^test_/i, "")
      .replace(/_(test|spec)$/i, "")
      .replace(/Tests?$/, ""),
    base.replace(/^(fakes?|mocks?|stubs?)_/i, ""),
  ];
  // foo.test.ts's stem is already foo; anywhere else, a name that didn't change isn't a subject.
  return [...new Set(names)].filter((one) => one !== "" && (marked || one !== base));
};

/** Up to three leading directories: where an unattached change is grouped. */
const area = (path: string): string => dirname(path).split("/").slice(0, 3).join("/");

const listed = (items: readonly string[]): string => {
  const shown = items.slice(0, MAX_LISTED);
  const rest = items.length - shown.length;
  const head = rest > 0 ? [...shown, `${rest} more`] : shown;
  return head.length <= 1 ? head.join("") : `${head.slice(0, -1).join(", ")} and ${head.at(-1)}`;
};

type FlowKind = Entry["kind"] | "root";

const KIND_RANK: Readonly<Record<FlowKind, number>> = { route: 0, page: 1, command: 2, root: 3 };

interface Start {
  /** Where the walk starts: the entry hunks, or a root. */
  readonly starts: readonly HunkId[];
  readonly entries: readonly Entry[];
  readonly kind: FlowKind;
}

interface Flow extends Start {
  readonly hunks: HunkId[];
  readonly via: HunkId[];
}

type StepDraft = Omit<TourStep, "id">;

/**
 * The tour without the model, as flows. A flow starts at an entry point (a route, a page, a
 * command) or at a root (code nothing calls that calls something) and reads the changed code it
 * runs, callers before callees. Code an earlier flow read goes in `via` instead. Registering an
 * entry, like adding a router to an app, is read first in that entry's flow.
 *
 * What no flow runs joins the flow it belongs with: a type the flow that uses it, any other code
 * the flow with most of its file, a test the flow it calls into, then its file's, then its
 * subject's; a doc the code in its directory. The rest goes into supporting steps: API schema,
 * docs, tests, and other changes by area.
 *
 * Flows that reach contract hunks come first, then routes, pages, commands and roots. Every
 * required hunk is in exactly one step.
 */
export const codeTour = (input: CodeTourInput): Tour => {
  const { files, required, callGraph, risk, definitions } = input;
  const generated = input.generated ?? new Set<string>();
  const located = files.flatMap((file) =>
    file.hunks.filter((hunk) => required.has(hunk.id)).map((hunk) => ({ file, hunk })),
  );
  const ids = located.map(({ hunk }) => hunk.id);
  const order = new Map(ids.map((id, at) => [id, at]));
  const fileOf = new Map(located.map(({ file, hunk }) => [hunk.id, file]));
  const pathOf = (id: HunkId): string => fileOf.get(id)?.path ?? "";
  const isTest = (id: HunkId) => isTestFile(pathOf(id));
  const isCode = (id: HunkId) => !isTest(id) && !isDoc(pathOf(id));
  const isSchemaLike = (id: HunkId) => generated.has(pathOf(id)) || isSchema(pathOf(id));
  const contract = new Set(
    risk.flatMap((assessment) => (assessment.riskClass === "contract" ? [assessment.hunkId] : [])),
  );

  // Calls in the order they're made, and type uses, between required hunks.
  const edges = () => new Map<HunkId, HunkId[]>(ids.map((id) => [id, []]));
  const [callees, callers, typeUses, usedAsType] = [edges(), edges(), edges(), edges()];
  for (const { fromHunkId: from, toHunkId: to, use } of [...callGraph].sort(
    (a, b) => a.line - b.line,
  )) {
    if (from === to || !required.has(from) || !required.has(to)) continue;
    const [out, back] = use === "call" ? [callees, callers] : [typeUses, usedAsType];
    if (!out.get(from)?.includes(to)) out.get(from)?.push(to);
    if (!back.get(to)?.includes(from)) back.get(to)?.push(from);
  }
  const codeCallees = (id: HunkId) => (callees.get(id) ?? []).filter(isCode);
  const codeCallers = (id: HunkId) => (callers.get(id) ?? []).filter(isCode);
  const reach = (starts: readonly HunkId[]): HunkId[] => {
    const seen: HunkId[] = [];
    const visit = (id: HunkId) => {
      if (seen.includes(id)) return;
      seen.push(id);
      for (const callee of codeCallees(id)) visit(callee);
    };
    for (const start of starts) visit(start);
    return seen;
  };

  // Entries. Entry hunks that change the same definition, like two hunks of one main, share a flow.
  const entryOfHunk = new Map<HunkId, Entry>();
  for (const { file, hunk } of located) {
    if (!isCode(hunk.id)) continue;
    const entry = entryOf(file, hunk, definitions.get(hunk.id) ?? []);
    if (entry !== null) entryOfHunk.set(hunk.id, entry);
  }
  const entryGroups = new Map<string, HunkId[]>();
  for (const [id, entry] of entryOfHunk) {
    const names = [...(definitions.get(id) ?? [])].sort().join(",");
    const key = entry.kind === "route" || names === "" ? id : `${pathOf(id)}#${names}`;
    entryGroups.set(key, [...(entryGroups.get(key) ?? []), id]);
  }

  // Wiring: nothing calls it, and it calls only entries.
  const wiring = new Map<HunkId, HunkId>();
  for (const id of ids.filter(isCode)) {
    const [first, ...rest] = codeCallees(id);
    if (
      first !== undefined &&
      !entryOfHunk.has(id) &&
      codeCallers(id).length === 0 &&
      [first, ...rest].every((callee) => entryOfHunk.has(callee))
    ) {
      wiring.set(id, first);
    }
  }
  const roots = ids.filter(
    (id) =>
      isCode(id) &&
      !entryOfHunk.has(id) &&
      !wiring.has(id) &&
      codeCallers(id).length === 0 &&
      codeCallees(id).length > 0,
  );

  const starts: Start[] = [
    ...[...entryGroups.values()].map((group): Start => {
      const entries = group.flatMap((id) => entryOfHunk.get(id) ?? []);
      return { starts: group, entries, kind: entries[0]?.kind ?? "root" };
    }),
    ...roots.map((root): Start => ({ starts: [root], entries: [], kind: "root" })),
  ];
  const reachesContract = (start: Start) => reach(start.starts).some((id) => contract.has(id));
  const firstAt = (start: Start) => Math.min(...start.starts.map((id) => order.get(id) ?? 0));
  starts.sort(
    (a, b) =>
      Number(reachesContract(b)) - Number(reachesContract(a)) ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      firstAt(a) - firstAt(b),
  );

  const owner = new Map<HunkId, Flow>();
  const flows: Flow[] = [];
  const own = (flow: Flow, id: HunkId) => {
    flow.hunks.push(id);
    owner.set(id, flow);
  };
  for (const start of starts) {
    const reached = reach(start.starts);
    const read = reached.filter((id) => owner.has(id));
    // A root whose code is mostly read already joins the flow it shares the most with.
    const host =
      start.kind === "root" && read.length * 2 >= reached.length - 1
        ? mostCommon(read.map((id) => owner.get(id)))
        : undefined;
    if (host !== undefined) {
      for (const id of reached.filter((one) => !owner.has(one))) own(host, id);
      continue;
    }
    const flow: Flow = { ...start, hunks: [], via: [] };
    flows.push(flow);
    for (const id of reached) {
      if (owner.has(id)) flow.via.push(id);
      else own(flow, id);
    }
  }
  for (const [id, entry] of wiring) {
    const flow = owner.get(entry);
    if (flow === undefined) continue;
    flow.hunks.unshift(id);
    owner.set(id, flow);
  }

  // Attach the rest, again while something joins: a test can follow a fake that just did.
  const flowWithMostOf = (path: string, kind: (id: HunkId) => boolean) =>
    mostCommon([...owner].flatMap(([id, flow]) => (pathOf(id) === path && kind(id) ? [flow] : [])));
  const flowOfSubject = (names: readonly string[]) =>
    mostCommon(
      [...owner].flatMap(([id, flow]) =>
        isCode(id) && names.includes(stem(basename(pathOf(id)))) ? [flow] : [],
      ),
    );
  const belongsWith = (id: HunkId): Flow | undefined => {
    const path = pathOf(id);
    // A schema or generated file a flow only names stays with the API schema.
    if (isSchemaLike(id)) return undefined;
    if (isCode(id)) {
      return (
        mostCommon((usedAsType.get(id) ?? []).map((user) => owner.get(user))) ??
        flowWithMostOf(path, isCode)
      );
    }
    if (isTest(id)) {
      // A test follows the code it calls; a test helper, like a fake, the tests that use it.
      const linked = [
        ...(callees.get(id) ?? []),
        ...(typeUses.get(id) ?? []),
        ...[...(callers.get(id) ?? []), ...(usedAsType.get(id) ?? [])].filter(isTest),
      ];
      return (
        mostCommon(linked.map((to) => owner.get(to))) ??
        flowWithMostOf(path, isTest) ??
        flowOfSubject(subjectNames(path))
      );
    }
    const here = flows.filter((flow) =>
      flow.hunks.some((other) => isCode(other) && dirname(pathOf(other)) === dirname(path)),
    );
    return here.length === 1 ? here[0] : undefined;
  };
  for (let joined = true; joined; ) {
    joined = false;
    for (const id of ids.filter((one) => !owner.has(one))) {
      const flow = belongsWith(id);
      if (flow !== undefined) {
        own(flow, id);
        joined = true;
      }
    }
  }

  // Reading order: code as walked, with each file's hunks together in file order; tests last.
  const byOrder = (a: HunkId, b: HunkId) => (order.get(a) ?? 0) - (order.get(b) ?? 0);
  for (const flow of flows) {
    const code: HunkId[] = [];
    for (const id of flow.hunks.filter((one) => !isTest(one))) {
      if (code.includes(id)) continue;
      const sameFile = flow.hunks.filter((other) => !isTest(other) && pathOf(other) === pathOf(id));
      code.push(...sameFile.sort(byOrder));
    }
    flow.hunks.splice(0, flow.hunks.length, ...code, ...flow.hunks.filter(isTest).sort(byOrder));
  }

  const stepOfFlow = new Map(flows.map((flow, at) => [flow, at + 1]));
  const stepOf = (id: HunkId) => {
    const flow = owner.get(id);
    return flow === undefined ? undefined : stepOfFlow.get(flow);
  };
  const steps: StepDraft[] = [
    ...flows.map((flow) => ({
      title: flowTitle(flow, pathOf, definitions),
      explanation: flowExplanation(flow, pathOf, isTest, stepOf),
      hunkIds: flow.hunks,
      kind: "flow" as const,
      via: flow.via,
      entries: flow.kind === "root" ? [] : flow.starts,
    })),
    ...supportingSteps(
      ids.filter((id) => !owner.has(id)),
      pathOf,
      isSchemaLike,
      isTest,
      contract,
    ),
  ];
  return {
    steps: steps.map((step, index) => ({ id: TourStepId.parse(`s${index + 1}`), ...step })),
    builtBy: "code",
  };
};

/** The value that occurs most, the first of them on a tie; undefined values don't count. */
const mostCommon = <T>(values: readonly (T | undefined)[]): T | undefined => {
  const counts = new Map<T, number>();
  for (const value of values) {
    if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: T | undefined;
  let most = 0;
  for (const [value, count] of counts) {
    if (count > most) {
      best = value;
      most = count;
    }
  }
  return best;
};

const flowTitle = (
  flow: Flow,
  pathOf: (id: HunkId) => string,
  definitions: ReadonlyMap<HunkId, readonly string[]>,
): string => {
  if (flow.entries.length > 0) return entryLabel(flow.entries);
  const start = flow.starts[0];
  const path = start === undefined ? "" : pathOf(start);
  const names = start === undefined ? [] : (definitions.get(start) ?? []);
  return names.length === 0 ? path : `${listed(names)} in ${basename(path)}`;
};

const flowExplanation = (
  flow: Flow,
  pathOf: (id: HunkId) => string,
  isTest: (id: HunkId) => boolean,
  stepOf: (id: HunkId) => number | undefined,
): string => {
  const names = (ids: readonly HunkId[]) => [...new Set(ids.map((id) => basename(pathOf(id))))];
  const tests = names(flow.hunks.filter(isTest));
  const earlier = [...new Set(flow.via.flatMap((id) => stepOf(id) ?? []))].sort((a, b) => a - b);
  const parts = [
    `Reads ${listed(names(flow.hunks.filter((id) => !isTest(id))))}`,
    ...(tests.length > 0 ? [`tested in ${listed(tests)}`] : []),
    ...(earlier.length === 0
      ? []
      : [
          `passes through ${earlier.length === 1 ? "step" : "steps"} ${listed(earlier.map(String))}`,
        ]),
  ];
  return `${parts.join("; ")}.`;
};

const SUPPORTING_RANK: Readonly<Record<string, number>> = { "API schema": 0, Docs: 1, Tests: 2 };

/** What no flow runs, by kind: API schema, docs, tests, then other changes by area. */
const supportingSteps = (
  left: readonly HunkId[],
  pathOf: (id: HunkId) => string,
  isSchemaLike: (id: HunkId) => boolean,
  isTest: (id: HunkId) => boolean,
  contract: ReadonlySet<HunkId>,
): StepDraft[] => {
  const groups = new Map<string, HunkId[]>();
  for (const id of left) {
    const path = pathOf(id);
    const where = area(path);
    const title = isSchemaLike(id)
      ? "API schema"
      : isDoc(path)
        ? "Docs"
        : isTest(id)
          ? "Tests"
          : `Other changes in ${where === "" ? "the repository root" : where}`;
    groups.set(title, [...(groups.get(title) ?? []), id]);
  }
  const contractCount = (hunks: readonly HunkId[]) => hunks.filter((id) => contract.has(id)).length;
  const rank = (title: string) => SUPPORTING_RANK[title] ?? 3;
  return [...groups]
    .sort(
      ([titleA, a], [titleB, b]) =>
        contractCount(b) - contractCount(a) ||
        rank(titleA) - rank(titleB) ||
        compare(titleA, titleB),
    )
    .map(([title, hunkIds]) => {
      const paths = [...new Set(hunkIds.map(pathOf))];
      const count = paths.length === 1 ? "1 file" : `${paths.length} files`;
      return {
        title,
        explanation: `${count}: ${listed(paths.map(basename))}. No flow runs ${paths.length === 1 ? "it" : "them"}.`,
        hunkIds,
        kind: "supporting" as const,
        via: [],
        entries: [],
      };
    });
};
