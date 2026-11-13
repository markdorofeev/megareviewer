import {
  type CallGraphHint,
  type FileChange,
  type HunkId,
  type HunkPart,
  hunkIdOf,
  isTestFile,
  type PartId,
  partsByHunk,
  piecesOf,
  routeReceivers,
} from "../diff/index.ts";
import { type Entry, entryLabel, entryOf } from "./entry-points.ts";
import type { RiskAssessment } from "./risk.ts";
import { type Tour, type TourStep, TourStepId } from "./tour.ts";

export interface CodeTourInput {
  readonly files: readonly FileChange[];
  /** Hunks without a mechanical proof: every one is in exactly one step. */
  readonly required: ReadonlySet<HunkId>;
  /** Split hunks' parts, which the tour places one by one. Any other hunk is one part. */
  readonly parts?: readonly HunkPart[];
  readonly callGraph: readonly CallGraphHint[];
  readonly risk: readonly RiskAssessment[];
  /** Each part's changed definitions, innermost, by name. */
  readonly definitions: ReadonlyMap<PartId, readonly string[]>;
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
  readonly starts: readonly PartId[];
  readonly entries: readonly Entry[];
  readonly kind: FlowKind;
}

interface Flow extends Start {
  readonly hunks: PartId[];
  readonly via: PartId[];
}

type StepDraft = Omit<TourStep, "id">;

/** A request a flow sends to a route an earlier step reads. */
interface Send {
  readonly route: PartId;
  readonly symbol: string;
  readonly step: number;
}

/**
 * The tour without the model: flows from entry points (routes, pages, commands) or roots, callers
 * before callees. Code several flows run is read once, in a shared section before them. What no
 * flow runs joins the flow it belongs with, else a supporting step. Every required hunk lands in
 * exactly one step; ARCHITECTURE.md has the ordering rules.
 */
export const codeTour = (input: CodeTourInput): Tour => {
  const { files, required, callGraph, risk, definitions } = input;
  const generated = input.generated ?? new Set<string>();
  const byHunk = partsByHunk(input.parts ?? []);
  const located = files.flatMap((file) =>
    piecesOf(file, byHunk)
      .filter(({ hunk }) => required.has(hunk.id))
      .map(({ id, hunk }) => ({ file, id, hunk })),
  );
  const ids: PartId[] = located.map(({ id }) => id);
  const order = new Map(ids.map((id, at) => [id, at]));
  const fileOf = new Map<PartId, FileChange>(located.map(({ file, id }) => [id, file]));
  const pathOf = (id: PartId): string => fileOf.get(id)?.path ?? "";
  const isTest = (id: PartId) => isTestFile(pathOf(id));
  const isCode = (id: PartId) => !isTest(id) && !isDoc(pathOf(id));
  const isSchemaLike = (id: PartId) => generated.has(pathOf(id)) || isSchema(pathOf(id));
  const contractHunks = new Set(
    risk.flatMap((assessment) => (assessment.riskClass === "contract" ? [assessment.hunkId] : [])),
  );
  const contract = new Set<PartId>(ids.filter((id) => contractHunks.has(hunkIdOf(id))));

  // Calls in the order they're made, type uses, and requests, between required hunks.
  const edges = () => new Map<PartId, PartId[]>(ids.map((id) => [id, []]));
  const [callees, callers, typeUses, usedAsType] = [edges(), edges(), edges(), edges()];
  /** The route parts each part requests, with the methods and paths, in line order. */
  const requests = new Map<PartId, Map<PartId, string[]>>();
  for (const { fromPartId: from, toPartId: to, use, symbol } of [...callGraph].sort(
    (a, b) => a.line - b.line,
  )) {
    if (from === to || !order.has(from) || !order.has(to)) continue;
    if (use === "request") {
      const routes = requests.get(from) ?? new Map<PartId, string[]>();
      routes.set(to, [...(routes.get(to) ?? []), symbol]);
      requests.set(from, routes);
      continue;
    }
    const [out, back] = use === "call" ? [callees, callers] : [typeUses, usedAsType];
    if (!out.get(from)?.includes(to)) out.get(from)?.push(to);
    if (!back.get(to)?.includes(from)) back.get(to)?.push(from);
  }
  const requestsOf = (id: PartId) => [...(requests.get(id) ?? [])];
  const codeCallees = (id: PartId) => (callees.get(id) ?? []).filter(isCode);
  const codeCallers = (id: PartId) => (callers.get(id) ?? []).filter(isCode);
  const reach = (starts: readonly PartId[]): PartId[] => {
    const seen: PartId[] = [];
    const visit = (id: PartId) => {
      if (seen.includes(id)) return;
      seen.push(id);
      for (const callee of codeCallees(id)) visit(callee);
    };
    for (const start of starts) visit(start);
    return seen;
  };

  // Entries. Entry hunks that change the same definition, like two hunks of one main, share a flow.
  const entryOfHunk = new Map<PartId, Entry>();
  for (const { file, id, hunk } of located) {
    if (!isCode(id)) continue;
    const entry = entryOf(file, hunk, definitions.get(id) ?? []);
    if (entry !== null) entryOfHunk.set(id, entry);
  }
  const entryGroups = new Map<string, PartId[]>();
  for (const [id, entry] of entryOfHunk) {
    const names = [...(definitions.get(id) ?? [])].sort().join(",");
    const key = entry.kind === "route" || names === "" ? id : `${pathOf(id)}#${names}`;
    entryGroups.set(key, [...(entryGroups.get(key) ?? []), id]);
  }

  // Wiring registers entries: a router the routes are declared on, or an app that adds a router.
  // It isn't an entry; it's used only as the router of entries' routes or by other wiring, or
  // nothing calls it; and it calls only entries and other wiring. It's linked to an entry.
  const textOf = new Map(located.map(({ id, hunk }) => [id, hunk.lines]));
  const onRouteLine = new Set<string>();
  for (const { fromPartId: from, toPartId: to, line, symbol } of callGraph) {
    const text = textOf.get(from)?.find((one) => one.kind !== "del" && one.newLine === line)?.text;
    if (text !== undefined && routeReceivers(text).includes(symbol))
      onRouteLine.add(`${from}>${to}`);
  }
  const wiring = new Set(
    ids.filter((id) => isCode(id) && !entryOfHunk.has(id) && linked(id).length > 0),
  );
  function linked(id: PartId): PartId[] {
    return [...codeCallers(id), ...codeCallees(id)];
  }
  for (let dropped = true; dropped; ) {
    dropped = false;
    for (const id of wiring) {
      const fits =
        codeCallers(id).every(
          (caller) => wiring.has(caller) || onRouteLine.has(`${caller}>${id}`),
        ) && codeCallees(id).every((callee) => wiring.has(callee) || entryOfHunk.has(callee));
      if (!fits) {
        wiring.delete(id);
        dropped = true;
      }
    }
  }
  /** The entries a wiring part registers, through other wiring too. */
  const registers = (id: PartId): PartId[] => {
    const seen = new Set<PartId>([id]);
    const found: PartId[] = [];
    const visit = (at: PartId) => {
      for (const other of linked(at)) {
        if (seen.has(other)) continue;
        seen.add(other);
        if (entryOfHunk.has(other)) found.push(other);
        else if (wiring.has(other)) visit(other);
      }
    };
    visit(id);
    return found;
  };
  for (const id of wiring) if (registers(id).length === 0) wiring.delete(id);
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
  const ordered = afterRequestedRoutes(starts, (start) =>
    reach(start.starts).flatMap((id) => requestsOf(id).map(([route]) => route)),
  );

  const owner = new Map<PartId, Flow>();
  const flows: Flow[] = [];
  const own = (flow: Flow, id: PartId) => {
    flow.hunks.push(id);
    owner.set(id, flow);
  };
  for (const start of ordered) {
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
  // Wiring is read first in the first flow of an entry it registers, before the wiring it adds.
  const flowAt = new Map(flows.map((flow, at) => [flow, at]));
  const placed = [...wiring].sort(
    (a, b) =>
      Number(codeCallers(a).some((one) => wiring.has(one))) -
        Number(codeCallers(b).some((one) => wiring.has(one))) ||
      (order.get(a) ?? 0) - (order.get(b) ?? 0),
  );
  const firstFlow = (id: PartId) =>
    registers(id)
      .flatMap((entry) => owner.get(entry) ?? [])
      .sort((a, b) => (flowAt.get(a) ?? 0) - (flowAt.get(b) ?? 0))[0];
  for (const id of placed.reverse()) {
    const flow = firstFlow(id);
    if (flow === undefined) continue;
    const before = owner.get(id);
    if (before !== undefined) before.hunks.splice(before.hunks.indexOf(id), 1);
    flow.hunks.unshift(id);
    owner.set(id, flow);
  }

  const consumers = new Map<PartId, Flow[]>();
  for (const flow of flows) {
    for (const id of reach(flow.starts)) {
      if (entryOfHunk.has(id) || wiring.has(id)) continue;
      consumers.set(id, [...(consumers.get(id) ?? []), flow]);
    }
  }
  const shared = new Set([...consumers].flatMap(([id, users]) => (users.length > 1 ? [id] : [])));
  /** Each shared section, and the flows that pass through it. */
  const usedBy = new Map<Flow, Flow[]>();
  while (shared.size > 0) {
    const first = ids.find((id) => shared.has(id));
    if (first === undefined) break;
    const component = new Set<PartId>();
    const collect = (id: PartId) => {
      if (!shared.delete(id)) return;
      component.add(id);
      for (const other of linked(id)) collect(other);
    };
    collect(first);
    const roots = [...component].filter(
      (id) => !codeCallers(id).some((caller) => component.has(caller)),
    );
    const orderedParts = reach([...roots, ...component]).filter((id) => component.has(id));
    const section: Flow = { starts: roots, entries: [], kind: "root", hunks: [], via: [] };
    const users: Flow[] = [];
    usedBy.set(section, users);
    for (const id of orderedParts) {
      const previous = owner.get(id);
      if (previous !== undefined) previous.hunks.splice(previous.hunks.indexOf(id), 1);
      own(section, id);
      for (const consumer of consumers.get(id) ?? []) {
        if (!consumer.via.includes(id)) consumer.via.push(id);
        if (!users.includes(consumer)) users.push(consumer);
      }
    }
  }
  flows.unshift(...usedBy.keys());

  // Attach the rest, again while something joins: a test can follow a fake that just did.
  const flowWithMostOf = (path: string, kind: (id: PartId) => boolean) =>
    mostCommon([...owner].flatMap(([id, flow]) => (pathOf(id) === path && kind(id) ? [flow] : [])));
  const flowOfSubject = (names: readonly string[]) =>
    mostCommon(
      [...owner].flatMap(([id, flow]) =>
        isCode(id) && names.includes(stem(basename(pathOf(id)))) ? [flow] : [],
      ),
    );
  const belongsWith = (id: PartId): Flow | undefined => {
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
      // A test that requests a route follows it; any other the code it calls; a test helper,
      // like a fake, the tests that use it.
      const requested = mostCommon(requestsOf(id).map(([route]) => owner.get(route)));
      if (requested !== undefined) return requested;
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
  const byOrder = (a: PartId, b: PartId) => (order.get(a) ?? 0) - (order.get(b) ?? 0);
  for (const flow of flows) {
    const code: PartId[] = [];
    for (const id of flow.hunks.filter((one) => !isTest(one))) {
      if (code.includes(id)) continue;
      const sameFile = flow.hunks.filter((other) => !isTest(other) && pathOf(other) === pathOf(id));
      code.push(...sameFile.sort(byOrder));
    }
    flow.hunks.splice(0, flow.hunks.length, ...code, ...flow.hunks.filter(isTest).sort(byOrder));
  }

  // A flow passes through the routes it requests in earlier flows, but never walks into them: a
  // page flow that read the backend would read the whole PR.
  const sendsOf = (flow: Flow, at: number): Send[] => {
    const sent: Send[] = [];
    for (const [route, symbols] of flow.hunks.flatMap(requestsOf)) {
      const routeAt = flows.findIndex((other) => other.hunks.includes(route));
      if (routeAt < 0 || routeAt >= at) continue;
      if (!flow.via.includes(route)) flow.via.push(route);
      for (const symbol of symbols) {
        if (!sent.some((one) => one.symbol === symbol))
          sent.push({ route, symbol, step: routeAt + 1 });
      }
    }
    return sent;
  };

  const stepOfFlow = new Map(flows.map((flow, at) => [flow, at + 1]));
  const stepOf = (id: PartId) => {
    const flow = owner.get(id);
    return flow === undefined ? undefined : stepOfFlow.get(flow);
  };
  const steps: StepDraft[] = [
    ...flows.map((flow, at) => {
      const sent = sendsOf(flow, at);
      return {
        title: `${usedBy.has(flow) ? "Shared: " : ""}${flowTitle(flow, pathOf, definitions)}`,
        explanation: flowExplanation(
          flow,
          pathOf,
          isTest,
          stepOf,
          sent,
          (usedBy.get(flow) ?? []).map((user) => stepOfFlow.get(user) ?? 0).sort((a, b) => a - b),
        ),
        partIds: flow.hunks,
        kind: "flow" as const,
        via: flow.via,
        entries: flow.kind === "root" ? [] : flow.starts,
        codeTitle: null,
        merged: [],
      };
    }),
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

/**
 * The starts with each moved after the starts whose routes it requests, in their order otherwise.
 * A cycle of requests keeps its order.
 */
const afterRequestedRoutes = (
  starts: readonly Start[],
  requestedBy: (start: Start) => readonly PartId[],
): Start[] => {
  const left = starts.map((start) => {
    const routes = requestedBy(start);
    const after = starts.filter(
      (other) => other !== start && other.starts.some((id) => routes.includes(id)),
    );
    return { start, after };
  });
  const placed: Start[] = [];
  while (left.length > 0) {
    const ready = left.findIndex(({ after }) => after.every((one) => placed.includes(one)));
    for (const { start } of left.splice(Math.max(ready, 0), 1)) placed.push(start);
  }
  return placed;
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
  pathOf: (id: PartId) => string,
  definitions: ReadonlyMap<PartId, readonly string[]>,
): string => {
  if (flow.entries.length > 0) return entryLabel(flow.entries);
  const start = flow.starts[0];
  const path = start === undefined ? "" : pathOf(start);
  const names = start === undefined ? [] : (definitions.get(start) ?? []);
  return names.length === 0 ? path : `${listed(names)} in ${basename(path)}`;
};

const flowExplanation = (
  flow: Flow,
  pathOf: (id: PartId) => string,
  isTest: (id: PartId) => boolean,
  stepOf: (id: PartId) => number | undefined,
  sends: readonly Send[],
  /** The steps that pass through a shared section. */
  users: readonly number[],
): string => {
  const names = (ids: readonly PartId[]) => [...new Set(ids.map((id) => basename(pathOf(id))))];
  const tests = names(flow.hunks.filter(isTest));
  const requested = new Set(sends.map((one) => one.route));
  const walkedVia = flow.via.filter((id) => !requested.has(id));
  const earlier = [...new Set(walkedVia.flatMap((id) => stepOf(id) ?? []))].sort((a, b) => a - b);
  const parts = [
    `Reads ${listed(names(flow.hunks.filter((id) => !isTest(id))))}`,
    ...(tests.length > 0 ? [`tested in ${listed(tests)}`] : []),
    ...(users.length === 0
      ? []
      : [`used by ${users.length === 1 ? "step" : "steps"} ${listed(users.map(String))}`]),
    ...(earlier.length === 0
      ? []
      : [
          `passes through ${earlier.length === 1 ? "step" : "steps"} ${listed(earlier.map(String))}`,
        ]),
    ...(sends.length === 0
      ? []
      : [
          `sends ${listed(
            [...sends]
              .sort((a, b) => a.step - b.step)
              .map(({ symbol, step }) => `${symbol} (step ${step})`),
          )}`,
        ]),
  ];
  return `${parts.join("; ")}.`;
};

const SUPPORTING_RANK: Readonly<Record<string, number>> = { "API schema": 0, Docs: 1, Tests: 2 };

/** What no flow runs, by kind: API schema, docs, tests, then other changes by area. */
const supportingSteps = (
  left: readonly PartId[],
  pathOf: (id: PartId) => string,
  isSchemaLike: (id: PartId) => boolean,
  isTest: (id: PartId) => boolean,
  contract: ReadonlySet<PartId>,
): StepDraft[] => {
  const groups = new Map<string, PartId[]>();
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
  const contractCount = (hunks: readonly PartId[]) => hunks.filter((id) => contract.has(id)).length;
  const rank = (title: string) => SUPPORTING_RANK[title] ?? 3;
  return [...groups]
    .sort(
      ([titleA, a], [titleB, b]) =>
        contractCount(b) - contractCount(a) ||
        rank(titleA) - rank(titleB) ||
        compare(titleA, titleB),
    )
    .map(([title, partIds]) => {
      const paths = [...new Set(partIds.map(pathOf))];
      const count = paths.length === 1 ? "1 file" : `${paths.length} files`;
      return {
        title,
        explanation: `${count}: ${listed(paths.map(basename))}. No flow runs ${paths.length === 1 ? "it" : "them"}.`,
        partIds,
        kind: "supporting" as const,
        via: [],
        entries: [],
        codeTitle: null,
        merged: [],
      };
    });
};
