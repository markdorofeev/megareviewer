import {
  CheckIcon,
  CircleDashedIcon,
  CircleUserIcon,
  GitPullRequestIcon,
  LoaderCircleIcon,
  type LucideIcon,
  SparklesIcon,
  TicketIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, type Ref, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";
import { initialsOf } from "../review/index.ts";
import { Button } from "../ui/button.tsx";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "../ui/popover.tsx";
import {
  type Account,
  accountsOf,
  type ButtonTone,
  type Connection,
  type ConnectionKind,
  type ConnectionState,
  type Connections,
  connectionsOf,
} from "./connections.ts";
import { useConnections } from "./connections-context.tsx";

// Spelled out because Tailwind only generates the classes it finds whole in the source.
const ISSUE_TONE: Readonly<Record<ButtonTone, string>> = {
  checking: "text-muted-foreground",
  ok: "",
  warning: "text-review-pending",
  danger: "text-destructive",
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

/**
 * The header's button: who the reviewer is, which is whose name a review posts under, and what's
 * wrong with the connections only when something is. Before anyone is known, the connections'
 * state alone.
 */
const AccountTrigger = ({
  account,
  label,
  tone,
}: {
  readonly account: Account | undefined;
  readonly label: string;
  readonly tone: ButtonTone;
}) => (
  <>
    {account === undefined ? (
      <CircleUserIcon aria-hidden="true" />
    ) : (
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-caption font-medium text-muted-foreground"
      >
        {initialsOf(account.name)}
      </span>
    )}
    {account !== undefined && <span className="hidden sm:inline">{account.name}</span>}
    {tone === "checking" && account === undefined && (
      <>
        <Spinner />
        {label}
      </>
    )}
    {(tone === "warning" || tone === "danger") && (
      <span className={cn("flex items-center gap-1", ISSUE_TONE[tone])}>
        <TriangleAlertIcon aria-hidden="true" />
        {label}
      </span>
    )}
    {tone === "ok" && account === undefined && label}
  </>
);

/** Who the reviewer is on each host that knows them, at the top of the popover. */
const SignedIn = ({ accounts }: { readonly accounts: readonly Account[] }) =>
  accounts.length === 0 ? null : (
    <div className="flex flex-col gap-0.5 px-1 text-caption text-muted-foreground">
      {accounts.map((account) => (
        <p key={account.host}>
          Signed in as <span className="font-medium text-foreground">{account.name}</span> on{" "}
          {account.host}
        </p>
      ))}
    </div>
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

/**
 * The header's one button and its popover: who the reviewer is, the connections, then whatever
 * the header puts under them, such as the display settings.
 */
export const ConnectionsPopover = ({
  connections,
  accounts,
  children,
  finalFocus,
  version,
  checking,
  open,
  onOpenChange,
  onCheckAgain,
  focusCheckAgain = false,
}: {
  readonly connections: Connections;
  readonly accounts: readonly Account[];
  readonly children?: ReactNode;
  /** Whether closing hands the focus back to the button: not when a picked view took it. */
  readonly finalFocus?: () => boolean;
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
  const [account] = accounts;
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
            variant="ghost"
            size="sm"
            className="gap-2 px-1.5"
            data-tone={tone}
            aria-label={
              account === undefined
                ? name
                : `${name} Signed in as ${account.name} on ${account.host}.`
            }
          />
        }
      >
        <AccountTrigger account={account} label={label} tone={tone} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(340px,calc(100vw-24px))] p-2"
        initialFocus={false}
        {...(finalFocus === undefined ? {} : { finalFocus })}
      >
        <SignedIn accounts={accounts} />
        <ConnectionsPanel
          connections={connections}
          version={version}
          checking={checking}
          onCheckAgain={() => {
            if (!checking) onCheckAgain();
          }}
          checkAgainRef={checkAgainRef}
        />
        {children}
      </PopoverContent>
    </Popover>
  );
};

/**
 * The header's one button, on every page: who the reviewer is and the connections, with
 * `children` under them in the popover. `children` is given a way to close the popover when a
 * choice in it moves the focus elsewhere, as picking a layout does.
 */
export const ConnectionsButton = ({
  now = Date.now,
  children,
}: {
  readonly now?: () => number;
  readonly children?: (closeOnPick: () => void) => ReactNode;
}) => {
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
  // A layout the page switches to takes the focus itself, so closing on it doesn't move it back.
  const picked = useRef(false);
  const closeOnPick = useCallback(() => {
    picked.current = true;
    setOpen(false);
  }, [setOpen]);

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
        accounts={accountsOf(status)}
        finalFocus={() => {
          const wasPicked = picked.current;
          picked.current = false;
          return !wasPicked;
        }}
        version={status?.version ?? null}
        checking={checking}
        open={open}
        onOpenChange={(next) => setOpen(next)}
        onCheckAgain={context.checkAgain}
        focusCheckAgain={focusCheckAgain}
      >
        {children?.(closeOnPick)}
      </ConnectionsPopover>
      <span className="sr-only" aria-live="polite">
        {announced}
      </span>
    </>
  );
};
