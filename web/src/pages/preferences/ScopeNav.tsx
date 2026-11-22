import { type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";
import { observeWidth, widthOf } from "../../lib/measure.ts";
import { cn } from "../../lib/utils.ts";
import { shortenRepoName } from "../../review/tree/names.ts";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../../ui/select.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip.tsx";
import { plural } from "./view.ts";

/** One row of the scope list, and one option of the narrow select. */
export interface ScopeEntry {
  /** The panel it opens, as the URL's `scope` names it. */
  readonly key: string;
  readonly icon: ReactNode;
  /** Its whole name, in the tooltip, the select's trigger and its accessible name. */
  readonly full: string;
  /** What the list shows: a repository's name, cut in the middle to fit. */
  readonly name: string;
  /** The owner before a name another repository listed shares, muted. */
  readonly owner: string | null;
  readonly count: number;
  /** "2 preferences", "2 waiting": the count in words. */
  readonly counted: string;
  /** The Suggestions row, in the AI's tint. */
  readonly ai?: boolean;
  /** A repository, whose owner the list leaves to the tooltip. */
  readonly repo?: boolean;
}

export interface ScopeEntries {
  readonly suggestions: ScopeEntry;
  readonly everywhere: ScopeEntry;
  readonly repositories: readonly ScopeEntry[];
}

export const countedPreferences = (count: number) => plural(count, "preference");
export const countedProposals = (count: number) => `${count} waiting`;

const nameOf = ({ full, count, counted }: ScopeEntry) => (count > 0 ? `${full}, ${counted}` : full);

/** A repository's name cut in the middle to fit its row, after its owner where that's shown. */
const ScopeName = ({ entry }: { readonly entry: ScopeEntry }) => {
  const box = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(entry.name);
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null || !entry.repo) return;
    return observeWidth(element, () => {
      const owner = element.firstElementChild;
      const name = element.lastElementChild;
      if (element.clientWidth === 0 || name === null) return;
      const room =
        element.clientWidth -
        (owner === null || owner === name ? 0 : (widthOf(owner, owner.textContent ?? "") ?? 0));
      setShown(shortenRepoName(entry.name, (text) => (widthOf(name, text) ?? 0) <= room + 0.5));
    });
  }, [entry.name, entry.repo]);
  return (
    <span ref={box} aria-hidden="true" className="min-w-0 flex-1 truncate text-left">
      {entry.owner !== null && <span className="text-muted-foreground">{entry.owner}/</span>}
      <span>{shown}</span>
    </span>
  );
};

const Count = ({ entry }: { readonly entry: ScopeEntry }) =>
  entry.count > 0 ? (
    <span
      aria-hidden="true"
      className={cn(
        "tabular shrink-0 text-caption",
        entry.ai
          ? "font-medium text-primary in-data-highlighted:text-accent-foreground"
          : "text-muted-foreground",
      )}
    >
      {entry.count}
    </span>
  ) : null;

const Row = ({
  entry,
  current,
  onSelect,
}: {
  readonly entry: ScopeEntry;
  readonly current: string;
  readonly onSelect: (key: string) => void;
}) => {
  const row = (
    <button
      type="button"
      aria-current={entry.key === current ? "page" : undefined}
      aria-label={nameOf(entry)}
      onClick={() => onSelect(entry.key)}
      className={cn(
        // The tree's hover fill: primary text is under 4.5:1 on accent in dark.
        "relative flex h-[34px] w-full items-center gap-2 rounded-md px-2.5 text-ui hover:bg-surface-row [&_svg]:text-muted-foreground",
        "aria-[current=page]:bg-secondary aria-[current=page]:font-medium aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-[7px] aria-[current=page]:before:left-0 aria-[current=page]:before:w-0.5 aria-[current=page]:before:rounded-full aria-[current=page]:before:bg-primary",
        entry.ai && "[&_svg]:text-primary",
      )}
    >
      {entry.icon}
      <ScopeName entry={entry} />
      <Count entry={entry} />
    </button>
  );
  return (
    <li>
      {entry.repo ? (
        // The list leaves the owner out, so every repository's row says its whole name here.
        <Tooltip>
          <TooltipTrigger delay={500} render={row} />
          <TooltipContent side="right" sideOffset={8}>
            {entry.full}
          </TooltipContent>
        </Tooltip>
      ) : (
        row
      )}
    </li>
  );
};

const GroupLabel = ({ id, children }: { readonly id: string; readonly children: string }) => (
  <p id={id} className="mt-4 mb-1 px-2.5 text-caption font-medium text-muted-foreground">
    {children}
  </p>
);

/** The scopes beside the panel at 1024px and wider: Suggestions, Everywhere, then each repository. */
export const ScopeList = ({
  entries,
  current,
  onSelect,
  className,
}: {
  readonly entries: ScopeEntries;
  readonly current: string;
  readonly onSelect: (key: string) => void;
  readonly className?: string;
}) => {
  const id = useId();
  return (
    <nav aria-label="Scopes" className={className}>
      <ul>
        <Row entry={entries.suggestions} current={current} onSelect={onSelect} />
        <Row entry={entries.everywhere} current={current} onSelect={onSelect} />
      </ul>
      {entries.repositories.length > 0 && (
        <>
          <GroupLabel id={`${id}-repositories`}>Repositories</GroupLabel>
          <ul aria-labelledby={`${id}-repositories`}>
            {entries.repositories.map((entry) => (
              <Row key={entry.key} entry={entry} current={current} onSelect={onSelect} />
            ))}
          </ul>
        </>
      )}
    </nav>
  );
};

const Option = ({ entry }: { readonly entry: ScopeEntry }) => (
  <SelectItem
    value={entry.key}
    label={entry.full}
    aria-label={nameOf(entry)}
    className="h-[34px] gap-2 pl-2.5 data-selected:font-medium [&_svg]:text-muted-foreground"
  >
    <span className={cn("flex", entry.ai && "[&_svg]:text-primary")}>{entry.icon}</span>
    <ScopeName entry={entry} />
    <Count entry={entry} />
  </SelectItem>
);

/** The scopes above the panel under 1024px, as a select of the same rows. */
export const ScopeSelect = ({
  entries,
  current,
  onSelect,
  className,
}: {
  readonly entries: ScopeEntries;
  readonly current: string;
  readonly onSelect: (key: string) => void;
  readonly className?: string;
}) => {
  const id = useId();
  const all = [entries.suggestions, entries.everywhere, ...entries.repositories];
  const chosen = all.find((entry) => entry.key === current) ?? entries.everywhere;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span id={`${id}-label`} className="text-caption font-medium text-muted-foreground">
        Scope
      </span>
      <Select
        value={chosen.key}
        items={all.map((entry) => ({ value: entry.key, label: entry.full }))}
        onValueChange={(next) => {
          if (typeof next === "string") onSelect(next);
        }}
      >
        <SelectTrigger
          aria-labelledby={`${id}-label`}
          className="h-10 w-full max-w-[440px] gap-2 rounded-lg px-3 text-body font-medium data-popup-open:border-ring data-popup-open:ring-3 data-popup-open:ring-ring/20 [&_svg]:text-muted-foreground"
        >
          <SelectValue>
            {() => (
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className={cn("flex", chosen.ai && "[&_svg]:text-primary")}>
                  {chosen.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{chosen.full}</span>
                <Count entry={chosen} />
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="start" sideOffset={6}>
          <SelectGroup>
            <Option entry={entries.suggestions} />
            <Option entry={entries.everywhere} />
          </SelectGroup>
          {entries.repositories.length > 0 && (
            <SelectGroup>
              <SelectLabel>Repositories</SelectLabel>
              {entries.repositories.map((entry) => (
                <Option key={entry.key} entry={entry} />
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </div>
  );
};
