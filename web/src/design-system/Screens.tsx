import { type ReactNode, useState } from "react";
import { RISK_STATUS, VERDICT_STATUS } from "../lib/status.ts";
import {
  CommentCard,
  CommentComposer,
  DiffViewer,
  FileTree,
  KeyHint,
  PrHeader,
  ReviewSubmitForm,
  useSyntax,
  type ViewLine,
} from "../review/index.ts";
import { Button } from "../ui/button.tsx";
import { StatusBadge } from "../ui/status-badge.tsx";
import { PENDING_COMMENTS, PULL_REQUEST, RETRY_FILE, TREE_FILES } from "./fixtures.ts";

const DECISIONS = [
  { id: "d1", text: "Retries 5 times instead of 3", verdict: VERDICT_STATUS.approved },
  { id: "d2", text: "Backs off exponentially: 1, 2, 4, 8 s", verdict: VERDICT_STATUS.approved },
  { id: "d3", text: "Stops retrying requests that were aborted", verdict: VERDICT_STATUS.rejected },
  { id: "d4", text: "Adds no jitter, so clients retry in step", verdict: VERDICT_STATUS.pending },
] as const;

const TABS = [
  { value: "files", label: "Files", count: TREE_FILES.length },
  { value: "decisions", label: "Decisions", count: DECISIONS.length },
  { value: "overview", label: "Overview" },
];

/** Three screens put together from the components, on made-up data. */
export const Screens = () => (
  <div className="flex flex-col gap-10">
    <Screen title="PR overview">
      <OverviewScreen />
    </Screen>
    <Screen title="A file's diff, with a comment being written">
      <DiffScreen />
    </Screen>
    <Screen title="Publishing the review">
      <PublishScreen />
    </Screen>
  </div>
);

const OverviewScreen = () => {
  const [active, setActive] = useState<string | null>(RETRY_FILE.path);
  const tokens = useSyntax(RETRY_FILE);
  return (
    <>
      <PrHeader
        pr={PULL_REQUEST}
        additions={81}
        deletions={56}
        status={VERDICT_STATUS.rejected}
        intent={
          <span>
            Retries back off exponentially instead of waiting a fixed second.{" "}
            <button
              type="button"
              className="text-left text-risk-contract underline-offset-2 hover:underline"
            >
              ▲ Also stops retrying aborted requests, which wasn't asked
            </button>
          </span>
        }
        tabs={TABS}
        activeTab="files"
        actions={
          <Button>
            Publish <KeyHint id="openReview" />
          </Button>
        }
      />
      <div className="grid gap-4 p-4 lg:grid-cols-[16rem_1fr]">
        <FileTree
          files={TREE_FILES}
          activePath={active}
          onSelect={setActive}
          navigate
          className="hidden h-[28rem] lg:flex"
        />
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-label="Decisions" className="rounded-lg border bg-card">
            <h2 className="border-b px-3 py-2 font-semibold">Decisions</h2>
            <ul className="divide-y">
              {DECISIONS.map((decision) => (
                <li key={decision.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1">{decision.text}</span>
                  <StatusBadge status={decision.verdict} />
                </li>
              ))}
            </ul>
          </section>
          <DiffViewer file={RETRY_FILE} tokens={tokens} />
        </div>
      </div>
    </>
  );
};

interface Draft {
  readonly id: number;
  readonly where: string;
  readonly body: string;
}

const placeOf = (lines: readonly ViewLine[]): string => {
  const numbers = lines.flatMap((line) => {
    const number = line.newNo ?? line.oldNo;
    return number === null ? [] : [number];
  });
  const first = numbers[0];
  const last = numbers.at(-1);
  return `${RETRY_FILE.path}:${first === last ? `${first}` : `${first}–${last}`}`;
};

const DiffScreen = () => {
  const tokens = useSyntax(RETRY_FILE);
  const hunk = RETRY_FILE.hunks[0];
  // From the old line 14 to new line 15: the changed signature and the line after it.
  const focus = hunk === undefined ? undefined : `${hunk.id}:4`;
  const anchor = hunk === undefined ? undefined : `${hunk.id}:2`;
  const [drafts, setDrafts] = useState<readonly Draft[]>([
    {
      id: 0,
      where: "src/http/retry.ts:45",
      body: "Why stop treating AbortError as a network error?",
    },
  ]);
  const [composing, setComposing] = useState<string | null>("src/http/retry.ts:14–15");
  // The composer on the page from the start doesn't take the focus; one opened with c does.
  const [opened, setOpened] = useState(false);
  return (
    <>
      <PrHeader
        compact
        pr={PULL_REQUEST}
        additions={81}
        deletions={56}
        status={VERDICT_STATUS.pending}
        actions={<Button size="sm">Publish</Button>}
      />
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={RISK_STATUS.logic} />
          <span className="text-muted-foreground">src/http/retry.ts, 2 hunks</span>
        </div>
        <DiffViewer
          file={RETRY_FILE}
          tokens={tokens}
          defaultFocus={focus}
          defaultAnchor={anchor}
          onComment={(lines) => {
            setComposing(placeOf(lines));
            setOpened(true);
          }}
        />
        {drafts.map((draft) => (
          <CommentCard as="article" state="draft" key={draft.id} className="flex flex-col gap-1">
            <header className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
              <span className="font-medium text-foreground">You</span>
              <span className="font-mono">{draft.where}</span>
              <StatusBadge status={VERDICT_STATUS.pending} label="Draft" />
            </header>
            <p className="text-body">{draft.body}</p>
          </CommentCard>
        ))}
        {composing !== null && (
          <CommentComposer
            key={composing}
            anchor={composing}
            autoFocus={opened}
            onSubmit={(body) => {
              setDrafts([...drafts, { id: drafts.length, where: composing, body }]);
              setComposing(null);
            }}
            onCancel={() => setComposing(null)}
          />
        )}
      </div>
    </>
  );
};

const PublishScreen = () => (
  <>
    <PrHeader
      compact
      pr={PULL_REQUEST}
      additions={81}
      deletions={56}
      status={VERDICT_STATUS.rejected}
      actions={<Button size="sm">Publish</Button>}
    />
    <div className="flex justify-end bg-surface-subtle p-4">
      <div className="w-full max-w-[420px] rounded-xl bg-popover p-4 text-popover-foreground shadow-md ring-1 ring-foreground/10">
        <ReviewSubmitForm
          title={<h2 className="text-heading font-semibold">Publish review</h2>}
          pending={PENDING_COMMENTS}
          decided={[3, 4]}
          canApprove
          defaultVerdict="request_changes"
          onCancel={() => undefined}
          onSubmit={() => new Promise((resolve) => setTimeout(resolve, 800))}
        />
      </div>
    </div>
  </>
);

const Screen = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => (
  <section className="flex flex-col gap-2">
    <h3 className="text-heading font-semibold">{title}</h3>
    <div className="overflow-hidden rounded-xl border bg-background shadow-sm">{children}</div>
  </section>
);
