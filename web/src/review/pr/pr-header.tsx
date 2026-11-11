import type { ReactNode } from "react";
import type { StatusStyle } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { StatusBadge } from "../../ui/status-badge.tsx";
import { Tabs, TabsCount, TabsList, TabsTrigger } from "../../ui/tabs.tsx";

/** What the header shows of a pull request. */
export interface PrSummary {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly authorName: string;
  readonly sourceBranch: string;
  readonly targetBranch: string;
}

export interface PrTab {
  readonly value: string;
  readonly label: string;
  readonly count?: number;
}

export interface PrHeaderProps {
  readonly pr: PrSummary;
  readonly additions: number;
  readonly deletions: number;
  /** The review's state so far, e.g. 2 decisions rejected. */
  readonly status?: StatusStyle;
  /** One line under the title: the intent, the mismatch chip, Details. */
  readonly intent?: ReactNode;
  readonly tabs?: readonly PrTab[];
  readonly activeTab?: string;
  readonly onTab?: (value: string) => void;
  /** Buttons at the end of the title row, such as Publish. */
  readonly actions?: ReactNode;
  /** One sticky row, for when the full header has scrolled away. */
  readonly compact?: boolean;
}

/** The pull request named once: title, number, branches, size, then its tabs. */
export const PrHeader = ({
  pr,
  additions,
  deletions,
  status,
  intent,
  tabs,
  activeTab,
  onTab,
  actions,
  compact = false,
}: PrHeaderProps) => {
  const title = (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "min-w-0 truncate font-semibold tracking-[-0.01em] hover:underline",
        compact ? "text-body" : "text-title",
      )}
    >
      {pr.title} <span className="font-normal text-muted-foreground">#{pr.number}</span>
    </a>
  );
  const size = (
    <span className="tabular font-mono text-code-compact">
      <span className="text-diff-add-fg">+{additions}</span>{" "}
      <span className="text-diff-del-fg">−{deletions}</span>
      <span className="sr-only">{` ${additions} lines added, ${deletions} removed`}</span>
    </span>
  );

  if (compact)
    return (
      <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b bg-background/95 px-4 shadow-sm backdrop-blur-sm">
        {title}
        {status !== undefined && <StatusBadge status={status} />}
        {size}
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </header>
    );

  return (
    <header className="flex flex-col gap-2 border-b bg-background px-4 pt-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="flex min-w-0 flex-1">{title}</h1>
        <div className="flex items-center gap-2">{actions}</div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        {status !== undefined && <StatusBadge status={status} />}
        <span>
          {pr.authorName} wants to merge{" "}
          <code className="rounded-sm bg-muted px-1 text-code-compact text-foreground">
            {pr.sourceBranch}
          </code>{" "}
          into{" "}
          <code className="rounded-sm bg-muted px-1 text-code-compact text-foreground">
            {pr.targetBranch}
          </code>
        </span>
        {size}
      </div>
      {intent !== undefined && <div className="text-body">{intent}</div>}
      {tabs !== undefined && tabs.length > 0 ? (
        <Tabs value={activeTab ?? tabs[0]?.value} onValueChange={(value) => onTab?.(String(value))}>
          <TabsList variant="underline" className="-mb-px">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
                {tab.count !== undefined && <TabsCount>{tab.count}</TabsCount>}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : (
        <div className="pb-2" />
      )}
    </header>
  );
};
