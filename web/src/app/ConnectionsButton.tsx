import {
  CheckIcon,
  CircleDashedIcon,
  GitPullRequestIcon,
  LoaderCircleIcon,
  type LucideIcon,
  SparklesIcon,
  TicketIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type Ref, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";
import { Button } from "../ui/button.tsx";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "../ui/popover.tsx";
import {
  type ButtonTone,
  type Connection,
  type ConnectionKind,
  type ConnectionState,
  type Connections,
  connectionsOf,
} from "./connections.ts";
import { useConnections } from "./connections-context.tsx";

// Spelled out because Tailwind only generates the classes it finds whole in the source.
const BUTTON_TONE: Readonly<Record<ButtonTone, string>> = {
  checking: "text-muted-foreground",
  ok: "",
  warning:
    "border-review-pending bg-review-pending-bg text-review-pending hover:bg-review-pending-bg hover:text-review-pending aria-expanded:bg-review-pending-bg aria-expanded:text-review-pending",
  danger:
    "border-destructive bg-review-changes-bg text-destructive hover:bg-review-changes-bg hover:text-destructive aria-expanded:bg-review-changes-bg aria-expanded:text-destructive",
};

const ICONS: Readonly<Record<ConnectionKind, LucideIcon>> = {
  github: GitPullRequestIcon,
  bitbucket: GitPullRequestIcon,
  claude: SparklesIcon,
  codex: SparklesIcon,
  opencode: SparklesIcon,
  jira: TicketIcon,
};

const STATE: Readonly<
  Record<
    ConnectionState,
    {
      readonly label: string;
      readonly icon: LucideIcon;
      readonly tone: string;
      readonly row: string;
    }
  >
> = {
  working: { label: "Connected", icon: CheckIcon, tone: "text-ci-success", row: "" },
  failing: {
    label: "Failing",
    icon: TriangleAlertIcon,
    tone: "text-destructive",
    row: "border-l-3 border-l-destructive bg-review-changes-bg",
  },
  "not-connected": {
    label: "Not connected",
    icon: CircleDashedIcon,
    tone: "text-review-pending",
    row: "border-l-3 border-l-review-pending bg-review-pending-bg",
  },
  optional: {
    label: "Not connected · Optional",
    icon: CircleDashedIcon,
    tone: "text-muted-foreground",
    row: "",
  },
  checking: {
    label: "Checking…",
    icon: LoaderCircleIcon,
    tone: "text-muted-foreground",
    row: "",
  },
};

/** Request AI review's tools: every one is optional, so the word would be on each of them. */
const MODEL_TOOLS: ReadonlySet<ConnectionKind> = new Set(["claude", "codex", "opencode"]);

const Spinner = ({ className }: { readonly className?: string }) => (
  <LoaderCircleIcon
    aria-hidden="true"
    className={cn("animate-spin motion-reduce:animate-[spin_3s_linear_infinite]", className)}
  />
);

const ButtonGlyph = ({ tone }: { readonly tone: ButtonTone }) =>
  tone === "checking" ? (
    <Spinner />
  ) : tone === "ok" ? (
    <CheckIcon aria-hidden="true" className="text-ci-success" />
  ) : (
    <TriangleAlertIcon aria-hidden="true" />
  );

const Row = ({ row }: { readonly row: Connection }) => {
  const state = STATE[row.state];
  const label =
    row.state === "optional" && MODEL_TOOLS.has(row.kind) ? "Not connected" : state.label;
  const Icon = ICONS[row.kind];
  const StateIcon = state.icon;
  return (
    <li
      data-state={row.state}
      className={cn(
        "flex flex-col gap-0.5 rounded-md px-2.5 py-2",
        state.row,
        row.state === "optional" && "text-muted-foreground",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span className="font-medium">{row.name}</span>
        <span className={cn("ml-auto flex items-center gap-1 text-caption", state.tone)}>
          <StateIcon
            aria-hidden="true"
            className={cn(
              "size-3.5",
              row.state === "checking" &&
                "animate-spin motion-reduce:animate-[spin_3s_linear_infinite]",
            )}
          />
          {label}
        </span>
      </div>
      {row.detail !== "" && <p className="text-caption">{row.detail}</p>}
      {row.fix !== null && <p className="text-caption">{row.fix}</p>}
    </li>
  );
};

/** The popover's content: the rows, or why there are none, with Check again and the version. */
export const ConnectionsPanel = ({
  connections,
  version,
  checking,
  onCheckAgain,
  checkAgainRef,
}: {
  readonly connections: Connections;
  readonly version: string | null;
  readonly checking: boolean;
  readonly onCheckAgain: () => void;
  readonly checkAgainRef?: Ref<HTMLButtonElement>;
}) => (
  <div className="flex flex-col gap-2">
    <div className="flex flex-col gap-0.5 px-1">
      <PopoverTitle className="text-heading font-semibold">Connections</PopoverTitle>
      <p className="text-caption text-muted-foreground">{connections.summary}</p>
    </div>
    {connections.disconnected !== null ? (
      <p className="rounded-md border-l-3 border-l-destructive bg-review-changes-bg px-2.5 py-2 text-caption">
        {connections.disconnected}
      </p>
    ) : (
      <ul className="flex flex-col gap-1">
        {connections.rows.map((row) => (
          <Row key={row.kind} row={row} />
        ))}
      </ul>
    )}
    <div className="flex items-center justify-between gap-2 border-t px-1 pt-2">
      <Button
        ref={checkAgainRef}
        variant="outline"
        size="sm"
        onClick={onCheckAgain}
        aria-busy={checking}
        aria-disabled={checking}
      >
        {checking && <Spinner />}
        Check again
      </Button>
      {version !== null && (
        <span className="text-caption text-muted-foreground">megareviewer {version}</span>
      )}
    </div>
  </div>
);

/** The button and its popover, from what the connections are. */
export const ConnectionsPopover = ({
  connections,
  version,
  checking,
  open,
  onOpenChange,
  onCheckAgain,
  focusCheckAgain = false,
}: {
  readonly connections: Connections;
  readonly version: string | null;
  readonly checking: boolean;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onCheckAgain: () => void;
  /** Check again takes the focus as the popover opens, as from Fix… on a list. */
  readonly focusCheckAgain?: boolean;
}) => {
  // Fix… opens the popover from outside its trigger, where the popover's own initial focus
  // doesn't apply, so Check again takes the focus as it mounts.
  const checkAgainRef = useCallback(
    (element: HTMLButtonElement | null) => {
      if (element !== null && focusCheckAgain) element.focus();
    },
    [focusCheckAgain],
  );
  const { label, tone, name } = connections.button;
  return (
    <Popover
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined
        ? {}
        : { onOpenChange: (next: boolean) => onOpenChange(next) })}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={BUTTON_TONE[tone]}
            data-tone={tone}
            aria-label={name}
          />
        }
      >
        <ButtonGlyph tone={tone} />
        {label}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(340px,calc(100vw-24px))] p-2"
        initialFocus={false}
      >
        <ConnectionsPanel
          connections={connections}
          version={version}
          checking={checking}
          onCheckAgain={() => {
            if (!checking) onCheckAgain();
          }}
          checkAgainRef={checkAgainRef}
        />
      </PopoverContent>
    </Popover>
  );
};

/** The header's Connections button, on every page, and the popover behind it. */
export const ConnectionsButton = ({ now = Date.now }: { readonly now?: () => number }) => {
  const context = useConnections();
  const { status, error, checking, checkedAtMs, listed, open, setOpen, focusCheckAgain } = context;
  const connections = connectionsOf({
    status,
    error,
    checking,
    checkedAtMs,
    listed,
    nowMs: now(),
  });
  const { label, tone } = connections.button;

  // Announced only once the first read is in, so opening the page says nothing.
  const [announced, setAnnounced] = useState("");
  const firstRead = useRef(true);
  useEffect(() => {
    if (tone === "checking") return;
    if (firstRead.current) {
      firstRead.current = false;
      return;
    }
    setAnnounced(`Connections: ${label}`);
  }, [label, tone]);

  return (
    <>
      <ConnectionsPopover
        connections={connections}
        version={status?.version ?? null}
        checking={checking}
        open={open}
        onOpenChange={(next) => setOpen(next)}
        onCheckAgain={context.checkAgain}
        focusCheckAgain={focusCheckAgain}
      />
      <span className="sr-only" aria-live="polite">
        {announced}
      </span>
    </>
  );
};
