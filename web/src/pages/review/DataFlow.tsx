import {
  ArrowDownIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DatabaseIcon,
  FlagIcon,
  LogInIcon,
  SparklesIcon,
  UnlinkIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import type { ModelRunOption } from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { nameOf } from "../../review/tree/paths.ts";
import type {
  DataFlowView,
  FileFamily,
  FlowFile,
  FlowStation,
  Lines,
  OffFlow,
} from "./data-flow.ts";
import { type FlowViewProps, STOP_STYLE, StatusGlyph, useFocusedStop } from "./flow-parts.tsx";
import { ModelText } from "./IntentLine.tsx";

const count = (n: number): string => n.toLocaleString("en-US");
const plural = (n: number, one: string): string => `${count(n)} ${n === 1 ? one : `${one}s`}`;

const linesInWords = ({ added, deleted }: Lines): string =>
  [
    added > 0 ? `${plural(added, "line")} added` : null,
    deleted > 0 ? `${count(deleted)} removed` : null,
  ]
    .filter((part) => part !== null)
    .join(", ");

/** Added and removed lines, a zero left out. On a chip they take the chip's own color. */
const LineCount = ({
  lines,
  plain = false,
}: {
  readonly lines: Lines;
  readonly plain?: boolean;
}) =>
  lines.added + lines.deleted === 0 ? null : (
    <span data-slot="flow-lines" className="shrink-0 font-mono text-kbd">
      <span aria-hidden="true" className="inline-flex gap-1">
        {lines.added > 0 && (
          <span className={cn(!plain && "text-diff-add-fg")}>+{count(lines.added)}</span>
        )}
        {lines.deleted > 0 && (
          <span className={cn(!plain && "text-diff-del-fg")}>−{count(lines.deleted)}</span>
        )}
      </span>
      <span className="sr-only">, {linesInWords(lines)}</span>
    </span>
  );

const CHIP =
  "inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-md border px-1.5 font-mono text-code-compact";

const FileChip = ({
  file,
  onOpen,
}: {
  readonly file: FlowFile;
  readonly onOpen: (path: string) => void;
}) => (
  <button
    type="button"
    data-slot="flow-file"
    data-path={file.path}
    data-status={file.status}
    className={cn(CHIP, STOP_STYLE[file.status], file.status === "changed" && "border-dashed")}
    title={file.path}
    onClick={() => onOpen(file.path)}
  >
    <StatusGlyph status={file.status} />
    <span className="truncate">{file.name}</span>
    <span className="sr-only">, {file.status === "new" ? "new file" : "existing file"}</span>
    <LineCount lines={file} plain />
  </button>
);

/** A file alone, or files that end alike as one chip that opens to them in place. */
const Family = ({
  family,
  open,
  onToggle,
  onOpenFile,
}: {
  readonly family: FileFamily;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onOpenFile: (path: string) => void;
}) => {
  const [first] = family.files;
  if (first === undefined) return null;
  if (family.suffix === null) return <FileChip file={first} onOpen={onOpenFile} />;
  const status = family.files.every((file) => file.status === "new") ? "new" : "changed";
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <>
      <button
        type="button"
        data-slot="flow-family"
        data-holds={family.files.map((file) => file.path).join("\n")}
        className={cn(CHIP, STOP_STYLE[status], status === "changed" && "border-dashed")}
        aria-expanded={open}
        title={family.files.map((file) => nameOf(file.path)).join("\n")}
        onClick={onToggle}
      >
        <Chevron aria-hidden="true" className="size-3 shrink-0" />
        <span className="truncate">
          {family.files.length} × …{family.suffix}
        </span>
        <span className="sr-only">, {status === "new" ? "new files" : "existing files"}</span>
        <LineCount lines={family} plain />
      </button>
      {open &&
        family.files.map((file) => <FileChip key={file.path} file={file} onOpen={onOpenFile} />)}
    </>
  );
};

/** Names a line spells out before "and N more". */
const MAX_NAMES = 3;

const Names = ({ names }: { readonly names: readonly string[] }) => (
  <>
    {names.slice(0, MAX_NAMES).map((name, at) => (
      <span key={name}>
        {at > 0 && ", "}
        <code className="font-mono text-code-compact text-foreground">{name}</code>
      </span>
    ))}
    {names.length > MAX_NAMES && ` and ${names.length - MAX_NAMES} more`}
  </>
);

/** Where existing code meets the station: what it calls there, or what's called in it. */
const Seams = ({ station }: { readonly station: FlowStation }) => {
  const existing = station.families
    .flatMap((family) => family.files)
    .filter((file) => file.calls.length + file.calledFor.length > 0);
  if (existing.length === 0) return null;
  return (
    <ul
      data-slot="flow-seams"
      className="mt-1.5 flex flex-col gap-0.5 text-caption text-muted-foreground"
    >
      {existing.map((file) => (
        <li key={file.path}>
          <code className="font-mono text-code-compact text-foreground">{file.name}</code>{" "}
          {file.calls.length > 0 ? (
            <>
              calls <Names names={file.calls} />
            </>
          ) : (
            <>
              is called for <Names names={file.calledFor} />
            </>
          )}
        </li>
      ))}
    </ul>
  );
};

const BADGE =
  "inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-caption text-muted-foreground";

export interface DataFlowProps extends Pick<FlowViewProps, "focusKey" | "onOpenFile"> {
  readonly view: DataFlowView;
  /** The model that wrote it, to say whose words the stations are. */
  readonly option: ModelRunOption | null;
}

/**
 * The Overview as the change's data flow: where the data comes in, the stations it passes through
 * with what each hands the next, and where it ends up; then a count of what the flow leaves out.
 * A file opens in the map.
 */
export const DataFlow = ({ view, option, focusKey, onOpenFile }: DataFlowProps) => {
  const box = useRef<HTMLElement>(null);
  useFocusedStop(box, focusKey);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpened((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const families = (owner: string, all: readonly FileFamily[]) =>
    all.map((family) => (
      <Family
        key={family.key}
        family={family}
        open={opened.has(`${owner}\u0000${family.key}`)}
        onToggle={() => toggle(`${owner}\u0000${family.key}`)}
        onOpenFile={onOpenFile}
      />
    ));
  const outside: Lines = {
    added: view.total.added - view.shown.added,
    deleted: view.total.deleted - view.shown.deleted,
  };
  const last = view.stations.length - 1;

  return (
    <section
      ref={box}
      data-slot="data-flow"
      aria-label="How data moves through this change"
      className="flex max-w-3xl flex-col gap-3"
    >
      <p data-slot="flow-byline" className="flex items-center gap-1.5 text-muted-foreground">
        <SparklesIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span>
          How data moves through this change, written by{" "}
          {option === null ? "the AI review" : `${option.modelName} through ${option.providerName}`}
          . Its files and arrows are checked against the code.
        </span>
      </p>

      <ol className="flex flex-col">
        {view.source !== null && (
          <li data-slot="flow-source">
            <p className="flex items-baseline gap-2 pl-1">
              <LogInIcon
                aria-hidden="true"
                className="size-4 shrink-0 self-center text-muted-foreground"
              />
              <span className="shrink-0 text-muted-foreground">Comes in</span>{" "}
              <span className="min-w-0 font-medium">
                <ModelText text={view.source} />
              </span>
            </p>
            <div aria-hidden="true" className="ml-4 h-3 border-input border-l-2" />
          </li>
        )}
        {view.stations.map((station, index) => {
          const handsOn =
            station.gives !== null ||
            station.shapes.length > 0 ||
            index < last ||
            view.end !== null;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: the stations of one flow never reorder.
            <li key={index} data-slot="flow-station" data-keeps={station.keeps || undefined}>
              <div
                className={cn(
                  "rounded-lg border bg-card px-3 py-2.5",
                  station.keeps && "border-4 border-double border-input",
                )}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="min-w-0 flex-1 font-medium text-ui">{station.name}</h3>
                  {station.keeps && (
                    <span className={BADGE}>
                      <DatabaseIcon aria-hidden="true" className="size-3" />
                      keeps data
                    </span>
                  )}
                  {station.when !== null && <span className={BADGE}>{station.when}</span>}
                  <LineCount lines={station} />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {families(`s${index}`, station.families)}
                </div>
                <Seams station={station} />
              </div>
              {handsOn && (
                <div
                  data-slot="flow-handoff"
                  data-joined={station.joined}
                  className={cn(
                    "ml-4 flex items-start gap-2 border-input border-l-2 py-2 pl-3",
                    !station.joined && "border-dashed",
                  )}
                >
                  <ArrowDownIcon
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <div className="flex min-w-0 flex-col gap-1.5">
                    {station.gives !== null && (
                      <p className="font-medium">
                        <span className="sr-only">Hands on: </span>
                        <ModelText text={station.gives} />
                      </p>
                    )}
                    {station.shapes.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-caption text-muted-foreground">as</span>
                        {families(`h${index}`, station.shapes)}
                      </div>
                    )}
                    {!station.joined && (
                      <p className="flex items-center gap-1 text-caption text-muted-foreground">
                        <UnlinkIcon aria-hidden="true" className="size-3 shrink-0" />
                        Not checked: no call was found between these two in the code.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {view.end !== null && (
          <li data-slot="flow-end">
            <p className="flex items-baseline gap-2 pl-1">
              <FlagIcon
                aria-hidden="true"
                className="size-4 shrink-0 self-center text-muted-foreground"
              />
              <span className="shrink-0 text-muted-foreground">Ends up in</span>{" "}
              <span className="min-w-0 font-medium">
                <ModelText text={view.end} />
              </span>
            </p>
          </li>
        )}
      </ol>

      <OffTheFlow
        off={view.off}
        outside={outside}
        total={view.total}
        opened={opened}
        onToggle={toggle}
        onOpenFile={onOpenFile}
      />
    </section>
  );
};

/** What the flow leaves out, as one line of counts; a kind opens to its files. */
const OffTheFlow = ({
  off,
  outside,
  total,
  opened,
  onToggle,
  onOpenFile,
}: {
  readonly off: readonly OffFlow[];
  readonly outside: Lines;
  readonly total: Lines;
  readonly opened: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
  readonly onOpenFile: (path: string) => void;
}) => (
  <section
    data-slot="flow-off"
    aria-label="Not in the picture"
    className="flex flex-col gap-2 border-t pt-3"
  >
    {off.length === 0 ? (
      <p className="text-muted-foreground">Every changed file is in the picture.</p>
    ) : (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <h3 className="font-medium text-ui">Not in the picture</h3>
        <span className="text-muted-foreground">
          {count(outside.added + outside.deleted)} of {count(total.added + total.deleted)} changed
          lines
        </span>
        {off.map((group) => {
          const open = opened.has(`off\u0000${group.id}`);
          const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
          return (
            <button
              key={group.id}
              type="button"
              data-slot="flow-off-group"
              data-holds={group.files.map((file) => file.path).join("\n")}
              className="inline-flex h-6 items-center gap-1 rounded-md border bg-card px-1.5 text-caption text-foreground"
              aria-expanded={open}
              onClick={() => onToggle(`off\u0000${group.id}`)}
            >
              <Chevron aria-hidden="true" className="size-3 shrink-0" />
              {group.label} · {plural(group.files.length, "file")}
              <LineCount lines={group} />
            </button>
          );
        })}
      </div>
    )}
    {off
      .filter((group) => opened.has(`off\u0000${group.id}`))
      .map((group) => (
        <section key={group.id} aria-label={group.label} className="flex flex-col gap-1">
          <h4 className="text-caption text-muted-foreground">{group.label}</h4>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {group.files.map((file) => (
              <li key={file.path} className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  data-slot="flow-off-file"
                  data-path={file.path}
                  className="min-h-6 text-left font-mono text-code-compact wrap-anywhere text-foreground underline decoration-input underline-offset-2 hover:decoration-foreground"
                  title={file.path}
                  onClick={() => onOpenFile(file.path)}
                >
                  {nameOf(file.path)}
                </button>
                <LineCount lines={file} />
              </li>
            ))}
          </ul>
        </section>
      ))}
  </section>
);
