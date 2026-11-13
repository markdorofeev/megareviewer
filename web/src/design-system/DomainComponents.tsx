import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Hunk } from "../../../src/domain/diff/index.ts";
import { mapModelStages, PointId } from "../../../src/domain/review/index.ts";
import { useShortcuts } from "../lib/keymap.ts";
import { VERDICT_STATUS } from "../lib/status.ts";
import { ClaudeElement } from "../pages/review/ClaudeElement.tsx";
import { PointCard } from "../pages/review/PointCard.tsx";
import {
  CollapsedHunk,
  CommentCard,
  CommentComposer,
  type CommentState,
  type Density,
  DiffSkeleton,
  DiffViewer,
  EmptyState,
  FileTree,
  HunkCard,
  KeyHint,
  type LineComment,
  type LinePlace,
  PrHeader,
  ReviewSubmitPanel,
  type ReviewThreadProps,
  ReviewThreadView,
  ShortcutsDialog,
  TreeSkeleton,
  useSyntax,
  type ViewLine,
} from "../review/index.ts";
import { Button } from "../ui/button.tsx";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx";
import {
  ADDED_FILE,
  BINARY_FILE,
  DELETED_FILE,
  DESIGN_RUN,
  generatedFile,
  PENDING_COMMENTS,
  POINTS,
  PULL_REQUEST,
  RENAMED_FILE,
  RETRY_FILE,
  THREADS,
  TREE_FILES,
} from "./fixtures.ts";
import { LandingDemo } from "./LandingDemo.tsx";

const DENSITIES: readonly Density[] = ["compact", "default", "comfy"];

const CARD_STATES: readonly (readonly [CommentState, string])[] = [
  ["draft", "A draft: the reviewer's own, posted with the review."],
  ["open", "An open thread."],
  ["resolved", "A resolved thread."],
  ["outdated", "An outdated thread: the code has changed since."],
];

/** The review page's components on made-up data, in each of their states. */
export const DomainComponents = () => {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useShortcuts({ help: () => setShortcutsOpen(true) });
  return (
    <div className="flex flex-col gap-10">
      <Group title="PR header">
        <div className="overflow-hidden rounded-lg border">
          <PrHeader
            pr={PULL_REQUEST}
            additions={81}
            deletions={56}
            status={VERDICT_STATUS.rejected}
            intent={
              <span>
                Retries back off exponentially instead of waiting a fixed second.{" "}
                <span className="text-risk-contract">▲ AbortError is no longer retried</span>
              </span>
            }
            tabs={[
              { value: "files", label: "Files", count: 8 },
              { value: "decisions", label: "Decisions", count: 4 },
              { value: "overview", label: "Overview" },
            ]}
            actions={<Button variant="outline">Details</Button>}
          />
        </div>
        <div className="overflow-hidden rounded-lg border">
          <PrHeader
            compact
            pr={PULL_REQUEST}
            additions={81}
            deletions={56}
            status={VERDICT_STATUS.pending}
            actions={<Button size="sm">Publish</Button>}
          />
        </div>
      </Group>

      <Group title="Diff viewer">
        <RetryDiff />
      </Group>

      <Group title="Diff viewer: a 5,000-line file, virtualized">
        <LongDiff />
      </Group>

      <Group title="Diff viewer: deferred, collapsed, binary, new, deleted, renamed, loading">
        <DiffViewer file={generatedFile(400)} deferred="Generated file, 200 lines changed." />
        <DiffViewer file={RETRY_FILE} defaultCollapsed />
        <DiffViewer file={BINARY_FILE} />
        <DiffViewer file={ADDED_FILE} />
        <DiffViewer file={DELETED_FILE} />
        <DiffViewer file={RENAMED_FILE} />
        <DiffSkeleton />
      </Group>

      <Group title="Collapsed hunk">
        <div className="overflow-hidden rounded-lg border">
          <CollapsedHunk hidden={17} />
          <CollapsedHunk hidden={64} onExpand={(direction) => toast(`Expand ${direction}`)} />
          <CollapsedHunk hidden={8} onExpand={() => undefined} />
          <CollapsedHunk hidden={64} expanding />
        </div>
      </Group>

      <Group title="File tree">
        <div className="grid gap-4 md:grid-cols-3">
          <TreeDemo mode="tree" />
          <TreeDemo mode="flat" />
          <div className="h-80 rounded-lg border p-2">
            <TreeSkeleton />
          </div>
        </div>
      </Group>

      <Group title="Comment composer">
        <CommentComposer
          autoFocus={false}
          anchor="src/http/retry.ts:16"
          onSubmit={(body) => {
            toast.success(`Comment saved: ${body}`);
          }}
          onCancel={() => toast("Cancelled")}
        />
        <CommentComposer
          autoFocus={false}
          anchor="src/http/retry.ts:45"
          defaultValue="This fails on purpose, to show the error state."
          onSubmit={() => Promise.reject(new Error("offline"))}
        />
      </Group>

      <Group title="Comment card">
        <div className="flex max-w-3xl flex-col gap-2">
          {CARD_STATES.map(([state, text]) => (
            <CommentCard key={state} state={state}>
              <p className="text-body">{text}</p>
            </CommentCard>
          ))}
        </div>
      </Group>

      <Group title="A draft on a line: click a line to write one, Edit to change it">
        <DraftDemo />
      </Group>

      <Group title="Claude's element in the header">
        <ClaudeStates />
      </Group>

      <Group title="Claude's run landing: Play reads for a moment, then lands">
        <LandingDemo />
      </Group>

      <Group title="Claude's points, one of each kind">
        <PointStates />
      </Group>

      <Group title="Review threads">
        <ThreadDemo label="Open, with a reply" thread={THREADS.open} />
        <ThreadDemo label="Two comments by one person under one header" thread={THREADS.grouped} />
        <ThreadDemo label="Resolved, folded to one line" thread={THREADS.resolved} />
        <ThreadDemo label="Outdated" thread={THREADS.outdated} />
        <ThreadDemo label="With a suggestion" thread={THREADS.suggestion} />
        <ThreadDemo
          label="A reply that's posting"
          thread={THREADS.open}
          initialReply={{ text: "Capped it at 1,000 entries.", status: "posting" }}
        />
        <ThreadDemo
          label="A reply that failed"
          thread={THREADS.open}
          initialReply={{
            text: "Capped it at 1,000 entries.",
            status: "failed",
            error: "Can't reach GitHub.",
          }}
        />
      </Group>

      <Group title="Review submit panel">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-muted-foreground">As a reviewer:</span>
          <ReviewSubmitPanel
            pending={PENDING_COMMENTS}
            decided={[3, 4]}
            canApprove
            defaultVerdict="request_changes"
            onSubmit={() => new Promise((resolve) => setTimeout(resolve, 600))}
          />
          <span className="text-muted-foreground">On your own PR:</span>
          <AuthorPanel />
        </div>
      </Group>

      <Group title="Key hints and shortcuts">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-2">
            Next file <KeyHint id="nextFile" />
          </span>
          <span className="flex items-center gap-2">
            Publish <KeyHint id="openReview" />
          </span>
          <span className="flex items-center gap-2">
            Send <KeyHint id="submit" />
          </span>
          <Button variant="outline" onClick={() => setShortcutsOpen(true)}>
            All shortcuts <KeyHint id="help" />
          </Button>
        </div>
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      </Group>

      <Group title="Empty states">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <EmptyState
              tone="done"
              glyph="✓"
              title="Every decision has a verdict"
              body="Publish the review to post it on the pull request."
              actions={[{ label: "Publish", onClick: () => undefined, shortcut: "openReview" }]}
            />
          </Card>
          <Card>
            <EmptyState
              glyph="∅"
              title="No changes"
              body="The pull request's head is the same as its base."
            />
          </Card>
          <Card>
            <EmptyState
              tone="info"
              glyph="○"
              title="No comments yet"
              body="Focus a line and press c to comment on it."
            />
          </Card>
          <Card>
            <EmptyState
              inline
              glyph="∅"
              title="No files match"
              body="Nothing in this PR has “payments” in its path."
              actions={[{ label: "Clear filter", onClick: () => undefined }]}
            />
          </Card>
        </div>
      </Group>
    </div>
  );
};

const RetryDiff = () => {
  const tokens = useSyntax(RETRY_FILE);
  const [density, setDensity] = useState<Density>("default");
  const [commenting, setCommenting] = useState<readonly ViewLine[] | null>(null);
  const [expanding, setExpanding] = useState<ReadonlySet<Hunk["id"]>>(new Set());
  const numbers = (commenting ?? []).flatMap((line) => {
    const number = line.newNo ?? line.oldNo;
    return number === null ? [] : [number];
  });
  const first = numbers[0];
  const last = numbers.at(-1);
  const where = `${RETRY_FILE.path}:${first === last ? `${first}` : `${first}–${last}`}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
        Density
        <ToggleGroup
          size="sm"
          variant="outline"
          value={[density]}
          onValueChange={(next) => {
            const chosen = DENSITIES.find((each) => each === next[0]);
            if (chosen !== undefined) setDensity(chosen);
          }}
          aria-label="Density"
        >
          {DENSITIES.map((each) => (
            <ToggleGroupItem key={each} value={each}>
              {each}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="text-caption">
          Click the diff, then ↑ ↓ to move, ⇧↑ ⇧↓ to select, c to comment.
        </span>
      </div>
      <DiffViewer
        file={RETRY_FILE}
        tokens={tokens}
        density={density}
        onComment={setCommenting}
        expanding={expanding}
        onExpand={(before) => {
          setExpanding(new Set([...expanding, before]));
          setTimeout(() => setExpanding(new Set()), 1500);
        }}
      />
      {commenting !== null && (
        <CommentComposer
          anchor={where}
          onSubmit={() => setCommenting(null)}
          onCancel={() => setCommenting(null)}
        />
      )}
    </div>
  );
};

const LongDiff = () => {
  const file = useMemo(() => generatedFile(4000), []);
  return <DiffViewer file={file} height="420px" onComment={() => undefined} />;
};

const TreeDemo = ({ mode }: { readonly mode: "tree" | "flat" }) => {
  const [active, setActive] = useState<string | null>("src/http/retry.ts");
  return (
    <div className="flex h-80 flex-col rounded-lg border p-2">
      <p className="px-2 pb-1 text-caption font-medium text-muted-foreground">
        {mode === "tree" ? "Tree" : "Flat, by size"}
      </p>
      <FileTree
        files={TREE_FILES}
        activePath={active}
        onSelect={setActive}
        mode={mode}
        order="size"
        className="flex-1"
      />
    </div>
  );
};

const AuthorPanel = () => (
  <ReviewSubmitPanel
    pending={[]}
    decided={[0, 4]}
    canApprove={false}
    shortcut={false}
    onSubmit={() => undefined}
  />
);

/** Drafts on a hunk's lines, kept in memory, as the review page keeps them in local storage. */
const DraftDemo = () => {
  const hunk = RETRY_FILE.hunks[1];
  const [comments, setComments] = useState<readonly LineComment[]>([
    {
      side: "new",
      line: 44,
      body: "`ECONNRESET` and `ETIMEDOUT` aren't the only network errors.",
      suggestion: [
        '  return /^E(CONNRESET|TIMEDOUT|PIPE)$/.test(Reflect.get(error, "code") ?? "");',
      ],
    },
  ]);
  const [open, setOpen] = useState<LinePlace | null>(null);
  if (hunk === undefined) return null;
  return (
    <div className="max-w-4xl overflow-hidden rounded-lg border">
      <HunkCard
        hunk={hunk}
        file={RETRY_FILE}
        risk={null}
        comments={comments}
        openComment={open}
        onOpenComment={(_, place) => setOpen(place)}
        onComment={(_, comment) => {
          const same = (other: LineComment) =>
            other.side === comment.side && other.line === comment.line;
          const empty =
            comment.body === "" &&
            comment.severity === undefined &&
            comment.suggestion === undefined;
          const rest = comments.filter((other) => !same(other));
          setComments(empty ? rest : [...rest, comment]);
        }}
      />
    </div>
  );
};

/** A thread on made-up data: replies and resolving answer after a moment, as a host would. */
const ThreadDemo = ({
  label,
  ...props
}: { readonly label: string } & Pick<ReviewThreadProps, "thread" | "initialReply">) => (
  <div className="flex flex-col gap-1">
    <span className="text-caption text-muted-foreground">{label}</span>
    <ReviewThreadView
      authorId="dana-kim"
      now={Date.parse("2026-10-21T10:00:00Z")}
      language="typescript"
      covered={["const RETRIES = 3;"]}
      onReply={async (body) => {
        toast.success(`Replied: ${body}`);
        return null;
      }}
      onResolve={async (resolved) => {
        toast(resolved ? "Resolved" : "Reopened");
        return null;
      }}
      {...props}
    />
  </div>
);

const Card = ({ children }: { readonly children: ReactNode }) => (
  <div className="rounded-lg border">{children}</div>
);

/** The header's Claude element, in each state a reviewer sees it in. */
const ClaudeStates = () => {
  const analysis = DESIGN_RUN;
  const ran = { ...analysis, stages: mapModelStages(analysis.stages, () => "done" as const) };
  const element = (label: string, node: ReactNode, reading = false) => (
    <div key={label} className="relative flex flex-wrap items-center gap-3 rounded-lg border p-3">
      {/* The header's bottom edge while Claude reads. */}
      {reading && (
        <span data-slot="model-hairline" data-state="running" aria-hidden="true">
          <span />
        </span>
      )}
      <span className="w-40 shrink-0 text-caption text-muted-foreground">{label}</span>
      {node}
    </div>
  );
  const shared = {
    via: "Claude Code, on your Pro plan",
    starting: false,
    error: null,
    onRun: () => {},
    onOpenList: () => {},
    onNext: () => {},
  };
  return (
    <div className="flex flex-col gap-2">
      {element(
        "Before it runs",
        <ClaudeElement
          analysis={analysis}
          running={false}
          startedAt={null}
          points={[]}
          {...shared}
        />,
      )}
      {element(
        "While it reads",
        <ClaudeElement
          analysis={analysis}
          running={true}
          startedAt={Date.now() - 42_000}
          points={[]}
          {...shared}
        />,
        true,
      )}
      {element(
        "The receipt",
        <ClaudeElement
          analysis={ran}
          running={false}
          startedAt={null}
          points={POINTS}
          {...shared}
        />,
      )}
      {element(
        "What's missing, and why",
        <ClaudeElement
          analysis={{
            ...ran,
            stages: { ...ran.stages, risk: "failed", decisions: "skipped" },
            modelError: {
              stage: "risk",
              code: "model-error",
              message: "Your Claude plan's usage limit is reached. It resets at 18:00.",
            },
          }}
          running={false}
          startedAt={null}
          points={POINTS.slice(0, 1)}
          {...shared}
        />,
      )}
      {element(
        "Nothing to raise",
        <ClaudeElement analysis={ran} running={false} startedAt={null} points={[]} {...shared} />,
      )}
    </div>
  );
};

/** A point card of each kind, and a dismissed one. */
const PointStates = () => (
  <div className="flex flex-col gap-2">
    {POINTS.map((point) => (
      <PointCard
        key={point.id}
        point={point}
        state="open"
        saving={false}
        readOnly={false}
        current={point.kind === "finding"}
        onRaise={() => {}}
        onState={() => {}}
      />
    ))}
    {POINTS[2] !== undefined && (
      <PointCard
        point={{ ...POINTS[2], id: PointId.parse("d2"), title: "Keeps the old retry helper" }}
        state="dismissed"
        saving={false}
        readOnly={false}
        current={false}
        onRaise={() => {}}
        onState={() => {}}
      />
    )}
  </div>
);

const Group = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => (
  <section className="flex flex-col gap-3">
    <h3 className="text-heading font-semibold">{title}</h3>
    {children}
  </section>
);
