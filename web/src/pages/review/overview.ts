import {
  hunkIdOf,
  isTestFile,
  type PartId,
  partsByHunk,
  piecesOf,
} from "../../../../src/domain/diff/index.ts";
import {
  type Analysis,
  entryOf,
  type RiskClass,
  type Route,
  type TourStep,
} from "../../../../src/domain/review/index.ts";

// The overview: a layered diagram of the changed files. It imports only domain code, so
// `pnpm measure` prints its rows with the page's own rules.

/** What an edge between two files carries. */
export type EdgeUse = "import" | "call" | "type";

export interface OverviewNode {
  /** The file's path, or `group:<directory>` for a group of files. */
  readonly key: string;
  readonly kind: "file" | "group";
  /** The files it stands for: one, or a group's. */
  readonly paths: readonly string[];
  /** The file's name with as many parent directories as make it unique; a group's directory. */
  readonly label: string;
  readonly added: number;
  readonly deleted: number;
  /** The highest risk class of its hunks. */
  readonly risk: RiskClass;
  /** Every file in it is one a tool wrote. */
  readonly generated: boolean;
  /** Where users reach it: "3 routes", "Page: SetupPage", "Command: main". */
  readonly entries: readonly string[];
  /** The titles of the flows that read it. */
  readonly flows: readonly string[];
  /** Its hunks to review, in tour order: a click opens the first. */
  readonly partIds: readonly PartId[];
  /** Test files and test helpers that link to it, directly or through a helper. */
  readonly badges: readonly string[];
  /** The row it sits in, from 0; -1 in the strip. */
  readonly row: number;
}

export interface OverviewEdge {
  readonly from: string;
  readonly to: string;
  /** In the order import, call, type. */
  readonly uses: readonly EdgeUse[];
  /** The symbols its calls and type uses name. */
  readonly symbols: readonly string[];
  /** It closes a cycle, so it points up instead of down. */
  readonly back: boolean;
}

export interface FileOverview {
  readonly rows: readonly (readonly OverviewNode[])[];
  readonly edges: readonly OverviewEdge[];
  /** Files no edge touches, docs, and tests that link to nothing. */
  readonly strip: readonly OverviewNode[];
  /** Each file's place: its node, its group, its strip item, or the first node it's a badge on. */
  readonly placeOf: ReadonlyMap<string, string>;
  /** Whether files are grouped by directory, because there are too many to show one by one. */
  readonly grouped: boolean;
}

/** Above this many file nodes, files group by directory. */
export const MAX_FILE_NODES = 40;

const RISK_RANK: Readonly<Record<RiskClass, number>> = { mechanical: 0, logic: 1, contract: 2 };
const USES: readonly EdgeUse[] = ["import", "call", "type"];

// Repository paths are always "/"-separated.
const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const dirname = (path: string): string => path.slice(0, Math.max(path.lastIndexOf("/"), 0));
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const isDoc = (path: string): boolean => /\.(md|mdx|rst|adoc)$/i.test(path);

/** A file whose name says it helps tests: fakes, mocks, stubs, fixtures, test utilities. */
const HELPER_NAME =
  /(^|[/_.-])(fakes?|mocks?|stubs?|fixtures?|testing|test[_-]?(utils?|helpers?|support))([/_.-]|$)/i;

/** Up to three leading directories: what a group of files is, as in the tour's areas. */
const area = (path: string): string => dirname(path).split("/").slice(0, 3).join("/");
const groupKey = (directory: string): string => `group:${directory}`;

/**
 * Each path's name plus as many parent directories as it takes to tell it from the others:
 * `routes/hosting_services.py` and `domain/hosting_services.py`.
 */
export const uniqueLabels = (paths: readonly string[]): ReadonlyMap<string, string> => {
  const parts = new Map(paths.map((path) => [path, path.split("/")]));
  const tail = (path: string, depth: number) => (parts.get(path) ?? []).slice(-depth).join("/");
  const labels = new Map<string, string>();
  for (const path of paths) {
    const most = parts.get(path)?.length ?? 1;
    let depth = 1;
    while (
      depth < most &&
      paths.some((other) => other !== path && tail(other, depth) === tail(path, depth))
    ) {
      depth += 1;
    }
    labels.set(path, tail(path, depth));
  }
  return labels;
};

const ROUTES = "\u0000routes";
const routeKey = (route: Route): string => `${route.method} ${route.path}`;

const routesLabel = (routes: readonly Route[]): string => {
  const [only] = routes;
  return routes.length === 1 && only !== undefined
    ? `${only.method} ${only.path}`
    : `${routes.length} routes`;
};

/**
 * The file nodes' entry labels, from the hunks each flow starts at. Routes are read again from
 * the entry hunks' added lines; a page or command is named by the flow's title, which is all the
 * page knows of it.
 */
const entryLabels = (
  analysis: OverviewInput,
  steps: readonly TourStep[],
): ReadonlyMap<string, readonly string[]> => {
  const byHunk = partsByHunk(analysis.parts);
  const located = new Map(
    analysis.files.flatMap((file) =>
      piecesOf(file, byHunk).map(({ id, hunk }) => [id, { file, hunk }] as const),
    ),
  );
  const labels = new Map<string, string[]>();
  const add = (path: string, label: string) => {
    const known = labels.get(path) ?? [];
    if (!known.includes(label)) labels.set(path, [...known, label]);
  };
  // A file's routes are one label, though each may start a flow of its own: where the first was.
  const routesOf = new Map<string, Route[]>();
  for (const step of steps) {
    const byFile = new Map<string, PartId[]>();
    for (const id of step.entries) {
      const path = located.get(id)?.file.path;
      if (path !== undefined) byFile.set(path, [...(byFile.get(path) ?? []), id]);
    }
    for (const [path, ids] of byFile) {
      const routes = ids.flatMap((id) => {
        const found = located.get(id);
        const entry = found === undefined ? null : entryOf(found.file, found.hunk, []);
        return entry?.kind === "route" ? entry.routes : [];
      });
      if (routes.length > 0) {
        add(path, ROUTES);
        routesOf.set(path, [...(routesOf.get(path) ?? []), ...routes]);
      }
      if (new Set(routes.map(routeKey)).size === ids.length && routes.length > 0) continue;
      for (const part of step.title.split("; ")) {
        if (part.startsWith("Page: ")) add(path, part);
        const command = /^Command: (\S+) in (.+)$/.exec(part);
        if (command !== null && command[2] === basename(path)) add(path, `Command: ${command[1]}`);
      }
    }
  }
  return new Map(
    [...labels].map(([path, names]) => {
      const routes = [...new Map((routesOf.get(path) ?? []).map((r) => [routeKey(r), r])).values()];
      return [path, names.map((name) => (name === ROUTES ? routesLabel(routes) : name))];
    }),
  );
};

/** Strongly connected components with more than one node, by Tarjan's algorithm. */
const cycles = (keys: readonly string[], out: (key: string) => readonly string[]): string[][] => {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];
  let next = 0;
  const visit = (key: string) => {
    index.set(key, next);
    low.set(key, next);
    next += 1;
    stack.push(key);
    onStack.add(key);
    for (const to of out(key)) {
      if (!index.has(to)) {
        visit(to);
        low.set(key, Math.min(low.get(key) ?? 0, low.get(to) ?? 0));
      } else if (onStack.has(to)) {
        low.set(key, Math.min(low.get(key) ?? 0, index.get(to) ?? 0));
      }
    }
    if (low.get(key) !== index.get(key)) return;
    const component: string[] = [];
    for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
      onStack.delete(top);
      component.push(top);
      if (top === key) break;
    }
    if (component.length > 1) found.push(component);
  };
  for (const key of keys) if (!index.has(key)) visit(key);
  return found;
};

interface Link {
  readonly uses: Set<EdgeUse>;
  readonly symbols: Set<string>;
}

/**
 * The overview of the changed files with a hunk to review. Code files are nodes; tests and test
 * helpers (files with a helper's name only tests link to) are badges on the nodes they link to;
 * docs, tests that link to nothing and nodes no edge touches sit in the strip.
 *
 * Edges come from imports and from calls and type uses between files. A node's row is one more
 * than its lowest caller's; a cycle is broken at the edge into its file earliest in tour order.
 * Rows are ordered by the mean position of each node's callers, then of its callees, then of its
 * callers again, with tour order on ties. Above 40 nodes, files group by directory, three levels
 * deep, except the groups in `expanded`.
 */
/** What the overview reads of an analysis. */
export type OverviewInput = Pick<
  Analysis,
  "files" | "parts" | "proofs" | "risk" | "callGraph" | "fileLinks" | "generated"
>;

export const fileOverview = (
  analysis: OverviewInput,
  steps: readonly TourStep[],
  expanded: ReadonlySet<string> = new Set(),
): FileOverview => {
  const mechanical = new Set(analysis.proofs.flatMap((proof) => proof.hunkId ?? []));
  const riskOf = new Map(analysis.risk.map((one) => [one.hunkId, one.riskClass]));
  const tourOrder = [...new Set(steps.flatMap((step) => step.partIds))];
  const rank = new Map(tourOrder.map((id, at) => [id, at]));
  const rankOf = (id: PartId) => rank.get(id) ?? tourOrder.length;
  const generated = new Set(analysis.generated);

  // The files with a hunk to review, and what the nodes show of each.
  const files = analysis.files.filter((file) =>
    file.hunks.some((hunk) => !mechanical.has(hunk.id)),
  );
  const pathOfHunk = new Map(
    files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, file.path] as const)),
  );
  const fileFacts = new Map(
    files.map((file) => {
      const lines = file.hunks.flatMap((hunk) => hunk.lines);
      const toReview = piecesOf(file, partsByHunk(analysis.parts))
        .map((piece) => piece.id)
        .filter((id) => !mechanical.has(hunkIdOf(id)))
        .sort((a, b) => rankOf(a) - rankOf(b));
      const risk = file.hunks
        .map(
          (hunk): RiskClass =>
            mechanical.has(hunk.id) ? "mechanical" : (riskOf.get(hunk.id) ?? "logic"),
        )
        .reduce((a, b) => (RISK_RANK[b] > RISK_RANK[a] ? b : a), "mechanical");
      return [
        file.path,
        {
          added: lines.filter((line) => line.kind === "add").length,
          deleted: lines.filter((line) => line.kind === "del").length,
          partIds: toReview,
          risk,
          rank: toReview.reduce((least, id) => Math.min(least, rankOf(id)), Infinity),
        },
      ] as const;
    }),
  );
  const fileRank = (path: string) => fileFacts.get(path)?.rank ?? Infinity;
  const byRank = (a: string, b: string) => fileRank(a) - fileRank(b) || compare(a, b);
  const paths = files.map((file) => file.path).sort(byRank);

  // Links between those files: imports, calls and type uses.
  const links = new Map<string, Map<string, Link>>();
  const link = (from: string, to: string, use: EdgeUse, symbol?: string) => {
    if (from === to || !fileFacts.has(from) || !fileFacts.has(to)) return;
    const out = links.get(from) ?? new Map<string, Link>();
    const one = out.get(to) ?? { uses: new Set<EdgeUse>(), symbols: new Set<string>() };
    one.uses.add(use);
    if (symbol !== undefined) one.symbols.add(symbol);
    out.set(to, one);
    links.set(from, out);
  };
  for (const { from, to } of analysis.fileLinks) link(from, to, "import");
  for (const hint of analysis.callGraph) {
    const from = pathOfHunk.get(hunkIdOf(hint.fromPartId));
    const to = pathOfHunk.get(hunkIdOf(hint.toPartId));
    if (from !== undefined && to !== undefined) link(from, to, hint.use, hint.symbol);
  }
  const linkedFrom = (path: string) => [...(links.get(path)?.keys() ?? [])];
  const linkersOf = (path: string) => paths.filter((other) => links.get(other)?.has(path) === true);

  // Tests, then helpers: files with a helper's name that only tests and helpers link to.
  const testLike = new Set(paths.filter(isTestFile));
  for (let added = true; added; ) {
    added = false;
    for (const path of paths) {
      const linkers = linkersOf(path);
      if (
        !testLike.has(path) &&
        HELPER_NAME.test(path) &&
        linkers.length > 0 &&
        linkers.every((linker) => testLike.has(linker))
      ) {
        testLike.add(path);
        added = true;
      }
    }
  }
  const docs = paths.filter((path) => !testLike.has(path) && isDoc(path));
  const code = paths.filter((path) => !testLike.has(path) && !isDoc(path));
  const isCode = new Set(code);

  // Each test-like file's badges: the code it reaches directly or through test-like files.
  const badgesOf = new Map<string, string[]>();
  for (const test of [...testLike].sort(byRank)) {
    const reached: string[] = [];
    const seen = new Set<string>([test]);
    const walk = (path: string) => {
      for (const to of linkedFrom(path)) {
        if (seen.has(to)) continue;
        seen.add(to);
        if (isCode.has(to)) reached.push(to);
        else walk(to);
      }
    };
    walk(test);
    badgesOf.set(test, reached);
  }
  const testsOn = new Map<string, string[]>();
  for (const [test, reached] of badgesOf) {
    for (const path of reached) testsOn.set(path, [...(testsOn.get(path) ?? []), test]);
  }

  // Nodes: code files, or above the limit, groups of them by directory.
  const grouped = code.length > MAX_FILE_NODES;
  const members = new Map<string, string[]>();
  for (const path of code) {
    const directory = area(path);
    const key = grouped && !expanded.has(groupKey(directory)) ? groupKey(directory) : path;
    members.set(key, [...(members.get(key) ?? []), path]);
  }
  // A group of one file is that file.
  for (const [key, inIt] of [...members]) {
    const [only] = inIt;
    if (key.startsWith("group:") && inIt.length === 1 && only !== undefined) {
      members.delete(key);
      members.set(only, [only]);
    }
  }
  const nodeOf = new Map<string, string>();
  for (const [key, inIt] of members) for (const path of inIt) nodeOf.set(path, key);
  const keyRank = (key: string) => Math.min(...(members.get(key) ?? [key]).map(fileRank));
  const keyOrder = (a: string, b: string) => keyRank(a) - keyRank(b) || compare(a, b);
  const keys = [...members.keys()].sort(keyOrder);

  // Edges between nodes, one per pair.
  const nodeLinks = new Map<string, Map<string, Link>>();
  for (const [from, out] of links) {
    for (const [to, one] of out) {
      const a = nodeOf.get(from);
      const b = nodeOf.get(to);
      if (a === undefined || b === undefined || a === b) continue;
      const byTo = nodeLinks.get(a) ?? new Map<string, Link>();
      const merged = byTo.get(b) ?? { uses: new Set<EdgeUse>(), symbols: new Set<string>() };
      for (const use of one.uses) merged.uses.add(use);
      for (const symbol of one.symbols) merged.symbols.add(symbol);
      byTo.set(b, merged);
      nodeLinks.set(a, byTo);
    }
  }
  const touched = new Set(
    [...nodeLinks].flatMap(([from, out]) => (out.size > 0 ? [from, ...out.keys()] : [])),
  );
  const inDiagram = keys.filter((key) => touched.has(key));

  // Break cycles at the edge into the node earliest in tour order, until there are none.
  const back = new Set<string>();
  const edgeKey = (from: string, to: string) => `${from}\u0000${to}`;
  const forward = (key: string) =>
    [...(nodeLinks.get(key)?.keys() ?? [])].filter((to) => !back.has(edgeKey(key, to)));
  for (
    let found = cycles(inDiagram, forward);
    found.length > 0;
    found = cycles(inDiagram, forward)
  ) {
    for (const component of found) {
      const [first] = [...component].sort(keyOrder);
      for (const from of component) {
        if (first !== undefined && forward(from).includes(first)) back.add(edgeKey(from, first));
      }
    }
  }

  // Rows: one more than the lowest caller's, over forward edges.
  const callersOf = new Map<string, string[]>(inDiagram.map((key) => [key, []]));
  for (const from of inDiagram) {
    for (const to of forward(from)) callersOf.get(to)?.push(from);
  }
  const rowOf = new Map<string, number>();
  const rowFor = (key: string): number => {
    const known = rowOf.get(key);
    if (known !== undefined) return known;
    const row = Math.max(-1, ...(callersOf.get(key) ?? []).map(rowFor)) + 1;
    rowOf.set(key, row);
    return row;
  };
  const rowKeys: string[][] = [];
  for (const key of inDiagram) {
    const row = rowFor(key);
    while (rowKeys.length <= row) rowKeys.push([]);
    rowKeys[row]?.push(key);
  }

  // Fewer crossings: order each row by its neighbors' mean position, down, up and down again.
  const position = () =>
    new Map(rowKeys.flatMap((row) => row.map((key, at) => [key, at - (row.length - 1) / 2])));
  const calleesOf = (key: string) => forward(key);
  const sweep = (
    rowsInOrder: readonly string[][],
    neighbors: (key: string) => readonly string[],
  ) => {
    for (const row of rowsInOrder) {
      const at = position();
      const mean = (key: string) => {
        const around = neighbors(key).map((other) => at.get(other) ?? 0);
        return around.length === 0
          ? (at.get(key) ?? 0)
          : around.reduce((sum, x) => sum + x, 0) / around.length;
      };
      const means = new Map(row.map((key) => [key, mean(key)]));
      row.sort((a, b) => (means.get(a) ?? 0) - (means.get(b) ?? 0) || keyOrder(a, b));
    }
  };
  const callers = (key: string) => callersOf.get(key) ?? [];
  sweep(rowKeys.slice(1), callers);
  sweep(rowKeys.slice(0, -1).reverse(), calleesOf);
  sweep(rowKeys.slice(1), callers);

  // What each node shows.
  const labels = uniqueLabels(paths);
  const entries = entryLabels(analysis, steps);
  const flowsOf = new Map<string, string[]>();
  for (const step of steps) {
    if (step.kind !== "flow") continue;
    for (const path of new Set(step.partIds.flatMap((id) => pathOfHunk.get(hunkIdOf(id)) ?? []))) {
      flowsOf.set(path, [...(flowsOf.get(path) ?? []), step.title]);
    }
  }
  const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];
  const node = (key: string, row: number): OverviewNode => {
    const inIt = members.get(key) ?? [key];
    const facts = inIt.flatMap((path) => fileFacts.get(path) ?? []);
    const group = key.startsWith("group:");
    return {
      key,
      kind: group ? "group" : "file",
      paths: inIt,
      label: group ? `${key.slice("group:".length) || "."}/` : (labels.get(key) ?? key),
      added: facts.reduce((sum, one) => sum + one.added, 0),
      deleted: facts.reduce((sum, one) => sum + one.deleted, 0),
      risk: facts
        .map((one) => one.risk)
        .reduce((a, b) => (RISK_RANK[b] > RISK_RANK[a] ? b : a), "mechanical"),
      generated: inIt.every((path) => generated.has(path)),
      entries: unique(inIt.flatMap((path) => entries.get(path) ?? [])),
      flows: unique(inIt.flatMap((path) => flowsOf.get(path) ?? [])),
      partIds: facts.flatMap((one) => one.partIds).sort((a, b) => rankOf(a) - rankOf(b)),
      badges: unique(inIt.flatMap((path) => testsOn.get(path) ?? [])).sort(byRank),
      row,
    };
  };
  const rows = rowKeys.map((row, at) => row.map((key) => node(key, at)));
  const strip = [
    ...keys.filter((key) => !touched.has(key)),
    ...docs,
    ...[...testLike].filter((test) => (badgesOf.get(test) ?? []).length === 0),
  ]
    .sort(keyOrder)
    .map((key) => node(key, -1));

  const placeOf = new Map<string, string>();
  for (const one of [...rows.flat(), ...strip])
    for (const path of one.paths) placeOf.set(path, one.key);
  for (const [test, reached] of badgesOf) {
    const [first] = reached;
    const at = first === undefined ? undefined : nodeOf.get(first);
    if (at !== undefined) placeOf.set(test, at);
  }

  const edges = [...nodeLinks].flatMap(([from, out]) =>
    [...out].map(
      ([to, one]): OverviewEdge => ({
        from,
        to,
        uses: USES.filter((use) => one.uses.has(use)),
        symbols: [...one.symbols].sort(compare),
        back: back.has(edgeKey(from, to)),
      }),
    ),
  );
  return { rows, edges, strip, placeOf, grouped };
};
