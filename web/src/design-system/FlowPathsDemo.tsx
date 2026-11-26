import { type ReactNode, useState } from "react";
import { HunkId } from "../../../src/domain/diff/index.ts";
import { FlowBowTie } from "../pages/review/FlowBowTie.tsx";
import { FlowLanes } from "../pages/review/FlowLanes.tsx";
import { FlowRows } from "../pages/review/FlowRows.tsx";
import type { FlowFolds } from "../pages/review/flow-parts.tsx";
import type { FlowPaths, Stop } from "../pages/review/flow-paths.ts";

let parts = 0;
const partId = () => {
  parts += 1;
  return HunkId.parse(`h_${parts.toString(16).padStart(16, "0")}`);
};

const stop = (layer: string, label: string, more: Partial<Stop> = {}): Stop => ({
  path: `src/${layer}/${label}.ts`,
  label,
  layer: `src/${layer}`,
  status: "changed",
  names: [],
  partIds: [partId()],
  shared: 1,
  uses: 0,
  from: null,
  calledBy: [],
  ...more,
});

/** A stop on a path that reaches it from others, under the first. */
const under = (one: Stop, caller: Stop, ...others: Stop[]): Stop => ({
  ...one,
  from: caller.path,
  calledBy: [caller, ...others].map((each) => each.label),
});
const call = (from: Stop, to: Stop) => ({ from: from.path, to: to.path });

const page = stop("pages", "RefundPage", { names: ["RefundPage"] });
const route = stop("routes", "refunds", { names: ["POST /refunds"] });
const refundService = stop("services", "refundService", {
  names: ["refund"],
  shared: 2,
  uses: 4,
});
const ledger = stop("services", "ledger", { status: "new", names: ["record"] });
const limits = stop("services", "limits", { status: "new" });
const tax = stop("services", "tax");
const refundStore = stop("stores", "refundStore", { status: "new", shared: 2 });
const ledgerStore = stop("stores", "ledgerStore");

const CALLS = [
  ...[refundService, ledger, limits, tax].map((to) => call(route, to)),
  call(refundService, ledger),
  call(refundService, refundStore),
  call(ledger, ledgerStore),
];

const FLOW: FlowPaths = {
  paths: [
    {
      key: "flow:0",
      labels: ["POST /refunds", "POST /refunds/{id}/retry"],
      stops: [
        route,
        under(refundService, route),
        under(ledger, route, refundService),
        under(limits, route),
        under(tax, route),
        under(refundStore, refundService),
        under(ledgerStore, ledger),
      ],
      calls: CALLS,
      ends: [],
    },
    {
      key: "flow:1",
      labels: ["Page: RefundPage"],
      stops: [page],
      calls: [],
      ends: [
        {
          label: "POST /refunds/{refundId}/approvals/{approvalId}/retries",
          partId: route.partIds[0] ?? partId(),
          from: page.path,
        },
      ],
    },
    {
      key: "file:src/services/refundService.ts",
      labels: ["retryRefunds in refundService.ts"],
      stops: [refundService, under(refundStore, refundService)],
      calls: [call(refundService, refundStore)],
      ends: [],
    },
  ],
  layers: [
    { key: "src/routes", label: "routes" },
    { key: "src/pages", label: "pages" },
    { key: "src/services", label: "services" },
    { key: "src/stores", label: "stores" },
  ],
  calls: CALLS,
  unreached: [stop("config", "refundWindow", { shared: 0 })],
  also: {
    tests: [
      "src/services/refundService.test.ts",
      "src/services/a-refund-of-a-partly-shipped-order.test.ts",
    ],
    docs: ["docs/refunds.md"],
    generated: ["src/api/schema.d.ts"],
    mechanical: ["src/services/money.ts"],
    other: ["openapi.json"],
  },
};

/** Every changed file on a path. */
const ON_PATHS: FlowPaths = {
  ...FLOW,
  unreached: [],
  also: { tests: [], docs: [], generated: [], mechanical: [], other: [] },
};
const NO_PATHS: FlowPaths = { ...ON_PATHS, paths: [], layers: [], calls: [] };

const VIEW = { flow: FLOW, onOpenPart: () => {}, onOpenFile: () => {}, focusKey: null };

const useFolds = (start: readonly string[] = []): FlowFolds => {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set(start));
  return {
    opened,
    onToggle: (key) =>
      setOpened((previous) => {
        const next = new Set(previous);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
  };
};

/** The overview's three preview forms on one made-up pull request. */
export const FlowPathsDemo = () => {
  const lanes = useFolds();
  const bowTie = useFolds();
  const openedBowTie = useFolds(["through:src/services", "end:src/services", "end:src/stores"]);
  return (
    <div className="flex flex-col gap-10">
      <Form title="Lanes">
        <FlowLanes {...VIEW} {...lanes} />
      </Form>
      <Form title="Bow tie">
        <FlowBowTie {...VIEW} {...bowTie} />
      </Form>
      <Form title="Bow tie, with directories opened to their files">
        <FlowBowTie {...VIEW} {...openedBowTie} flow={ON_PATHS} />
      </Form>
      <Form title="Flow rows">
        <FlowRows {...VIEW} />
      </Form>
      <Form title="No flow in the pull request">
        <FlowRows {...VIEW} flow={NO_PATHS} />
      </Form>
    </div>
  );
};

const Form = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-3">
    <h3 className="text-heading font-semibold">{title}</h3>
    {children}
  </div>
);
