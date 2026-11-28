import { ChevronRightIcon, FileTextIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import type {
  LinkedGuidelineFile,
  RepositoryGuidelineFile,
  RepositoryPreferences,
} from "../../../../contracts/index.ts";
import {
  GUIDELINE_PATHS,
  MAX_HARNESS_DEPTH,
  MAX_HARNESS_FILES,
  MAX_HARNESS_LOOKUPS,
  MAX_INLINE_BYTES,
} from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { Switch } from "../../ui/switch.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip.tsx";
import {
  byLinking,
  formatBytes,
  linkedTotal,
  linkedUses,
  plural,
  sentence,
  USE_WORDS,
  WOULD_USE_WORDS,
} from "./view.ts";

const LOOKED_FOR = `megareviewer looks for ${new Intl.ListFormat("en", { type: "disjunction" }).format(GUIDELINE_PATHS)}.`;

const CUT: Readonly<Record<NonNullable<RepositoryPreferences["harnessCut"]>, string>> = {
  depth: `Links are followed up to ${MAX_HARNESS_DEPTH} files deep from a guideline file. A file further away isn't listed, and AI reviews don't use it.`,
  files: `Links are followed to ${MAX_HARNESS_FILES} files, looking for ${MAX_HARNESS_LOOKUPS} at most. A file past that isn't listed, and AI reviews don't use it.`,
};

const SKIPPED: Readonly<Record<RepositoryPreferences["harnessSkipped"][number]["reason"], string>> =
  {
    "too-large": "is over 1 MB, so AI reviews don't use it.",
    unreadable: "couldn't be read as text, so AI reviews don't use it.",
  };

/** Switches a file, and answers why that failed, or null. */
type OnSwitch = (path: string, enabled: boolean) => Promise<string | null>;

/** A file's path, its size, and at the end its switch with what it means in words. */
const FileRow = ({
  path,
  bytes,
  note,
  words,
  used,
  enabled,
  onSwitch,
  className,
}: {
  readonly path: string;
  readonly bytes: number;
  readonly note?: string | null;
  readonly words: string;
  readonly used: boolean;
  /** null for a file switched somewhere else. */
  readonly enabled: boolean | null;
  readonly onSwitch: OnSwitch;
  readonly className?: string;
}) => {
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1", className)}>
      <FileTextIcon aria-hidden="true" className="size-[15px] shrink-0 text-muted-foreground" />
      <span className="min-w-0 font-mono text-code-compact break-all">{path}</span>
      <span className="tabular shrink-0 text-caption text-muted-foreground">
        {formatBytes(bytes)}
      </span>
      {note !== null && note !== undefined && (
        <span className="shrink-0 text-caption text-muted-foreground">{note}</span>
      )}
      <span className="ml-auto flex items-center gap-2">
        {enabled !== null && (
          <Switch
            checked={enabled}
            aria-label={`Use ${path} in AI reviews`}
            onCheckedChange={async (checked) => {
              setFailure(null);
              setFailure(await onSwitch(path, checked));
            }}
          />
        )}
        {/* The state in words, so it never rests on the thumb's place or its color. */}
        <span
          className={cn(
            "min-w-40 text-caption",
            used ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {words}
        </span>
      </span>
      {failure !== null && (
        <p role="alert" className="basis-full text-caption text-destructive">
          <TriangleAlertIcon aria-hidden="true" className="mr-1 inline size-3.5 align-[-2px]" />
          {failure}
        </p>
      )}
    </div>
  );
};

const sameAsWords = (path: string) => `Same as ${path}`;

const rootWords = ({ enabled, use, sameAs }: RepositoryGuidelineFile): string => {
  if (!enabled) return "Ignored";
  if (sameAs !== null) return sameAsWords(sameAs);
  return use === null
    ? `Left out: over the ${formatBytes(MAX_INLINE_BYTES)} a review holds`
    : USE_WORDS[use];
};

const linkedWords = (
  { enabled, use, currentUse, sameAs }: LinkedGuidelineFile,
  isRoot: boolean,
  rootOn: boolean,
): string => {
  // Another guideline file can bring it while the one it's listed under is off.
  if (currentUse !== null) return USE_WORDS[currentUse];
  if (sameAs !== null) return sameAsWords(sameAs);
  if (use !== null && !rootOn) return WOULD_USE_WORDS[use];
  if (isRoot) return "Has its own switch";
  return enabled ? "Ignored: links to it are off" : "Ignored";
};

const LinkedGroup = ({
  linkedFrom,
  files,
  roots,
  rootOn,
  onSwitch,
}: {
  readonly linkedFrom: string;
  readonly files: readonly LinkedGuidelineFile[];
  readonly roots: ReadonlySet<string>;
  readonly rootOn: boolean;
  readonly onSwitch: OnSwitch;
}) => {
  const id = useId();
  return (
    <>
      <p id={id} className="mt-3 mb-1 text-caption text-muted-foreground">
        Linked by <span className="font-mono break-all">{linkedFrom}</span>
      </p>
      <ul aria-labelledby={id}>
        {files.map((file) => (
          <li key={file.path} data-slot="linked-file">
            <FileRow
              path={file.path}
              bytes={file.bytes}
              note={file.via === "import" ? "imported" : null}
              words={linkedWords(file, roots.has(file.path), rootOn)}
              used={file.currentUse !== null}
              enabled={roots.has(file.path) ? null : file.enabled}
              onSwitch={onSwitch}
              className="min-h-9 py-1"
            />
          </li>
        ))}
      </ul>
    </>
  );
};

/** "Also links 3 files listed under AGENTS.md and 1 under REVIEW.md", the paths in code. */
const ListedElsewhere = ({
  listed,
  also,
}: {
  readonly listed: RepositoryGuidelineFile["listedElsewhere"];
  readonly also: boolean;
}) => (
  <span data-slot="listed-elsewhere" className="text-caption text-muted-foreground">
    {also ? "Also links " : "Links "}
    {listed.map(({ path, files }, index) => (
      <span key={path}>
        {index === 0 ? "" : index === listed.length - 1 ? " and " : ", "}
        {index === 0 ? `${plural(files, "file")} listed under ` : `${files} under `}
        <span className="font-mono break-all">{path}</span>
      </span>
    ))}
  </span>
);

/** What a guideline file reaches: how many files and how they're used, folded, then each of them. */
const LinkedFiles = ({
  file,
  roots,
  startOpen,
  onSwitch,
}: {
  readonly file: RepositoryGuidelineFile;
  readonly roots: ReadonlySet<string>;
  readonly startOpen: boolean;
  readonly onSwitch: OnSwitch;
}) => {
  const [open, setOpen] = useState(startOpen);
  const id = useId();
  if (file.linked.length === 0) {
    return (
      <div className="flex min-h-6 items-center pl-[25px]">
        <ListedElsewhere listed={file.listedElsewhere} also={false} />
      </div>
    );
  }
  return (
    <div className="pl-[25px]">
      <div className="flex flex-wrap items-center gap-x-2">
        <Button
          variant="ghost"
          size="xs"
          aria-label={`${linkedTotal(file.linked)}, from ${file.path}`}
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          className="-ml-2"
          onClick={() => setOpen(!open)}
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "transition-transform duration-(--duration-fast) ease-standard motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
          {linkedTotal(file.linked)}
        </Button>
        <span data-slot="linked-uses" className="text-caption text-muted-foreground">
          {file.enabled ? "" : "When on: "}
          {linkedUses(file.linked)}
        </span>
        {file.listedElsewhere.length > 0 && <ListedElsewhere listed={file.listedElsewhere} also />}
      </div>
      {open && (
        <div id={id} className="pb-1">
          {byLinking(file.linked).map(([linkedFrom, files]) => (
            <LinkedGroup
              key={linkedFrom}
              linkedFrom={linkedFrom}
              files={files}
              roots={roots}
              rootOn={file.enabled}
              onSwitch={onSwitch}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/** None found, with the files looked for behind an info button, out of the sentence's way. */
const NoneFound = () => {
  const id = useId();
  return (
    <p className="flex items-center gap-1 text-ui text-muted-foreground">
      None found at the repository's root.
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Files megareviewer looks for"
              aria-describedby={id}
            />
          }
        >
          <InfoIcon aria-hidden="true" className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent side="right">{LOOKED_FOR}</TooltipContent>
      </Tooltip>
      {/* The tooltip is for the eye; a screen reader reads the same words as the description. */}
      <span id={id} hidden>
        {LOOKED_FOR}
      </span>
    </p>
  );
};

const Note = ({ children }: { readonly children: ReactNode }) => (
  <li className="flex gap-1.5">
    <InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
    <span className="min-w-0">{children}</span>
  </li>
);

/** What the list doesn't have: files left out, a limit the links reached, or a load that isn't in. */
const LeftOut = ({
  section: { harnessCut, harnessSkipped, harnessNote },
}: {
  readonly section: RepositoryPreferences;
}) =>
  harnessCut === null && harnessSkipped.length === 0 && harnessNote === null ? null : (
    <ul
      data-slot="harness-notes"
      className="mt-2.5 flex max-w-[620px] flex-col gap-1 text-caption text-muted-foreground"
    >
      {harnessNote !== null && <Note>{sentence(harnessNote)}</Note>}
      {harnessCut !== null && <Note>{CUT[harnessCut]}</Note>}
      {harnessSkipped.map(({ path, reason }) => (
        <Note key={path}>
          <span className="font-mono break-all">{path}</span> {SKIPPED[reason]}
        </Note>
      ))}
    </ul>
  );

/**
 * A repository's guideline files, each with its size, switch and how a review uses it, and the
 * files it links, folded. Without any read, why.
 */
export const GuidelineFiles = ({
  section,
  onSwitch,
  startOpen = [],
}: {
  readonly section: RepositoryPreferences;
  readonly onSwitch: OnSwitch;
  /** The guideline files whose links start unfolded, for the design system. */
  readonly startOpen?: readonly string[];
}) => {
  const { guidelineFiles: files, guidelineNote } = section;
  if (files === null) {
    return (
      <p className="text-ui text-muted-foreground">
        {sentence(guidelineNote ?? "Couldn't look for them")}
      </p>
    );
  }
  const roots = new Set<string>(files.map(({ path }) => path));
  return (
    <>
      {files.length === 0 ? (
        <NoneFound />
      ) : (
        <>
          <p className="mb-2.5 max-w-[620px] text-ui text-muted-foreground">
            At the repository root, read at each pull request's base commit. When a file is on, AI
            reviews follow it the same way as your preferences, with the files it links; when off,
            it is ignored.
          </p>
          <ul
            data-slot="guideline-files"
            className="divide-y overflow-hidden rounded-lg border bg-card"
          >
            {files.map((file) => (
              <li key={file.path} data-slot="guideline-file" className="px-4 py-2">
                <FileRow
                  path={file.path}
                  bytes={file.bytes}
                  words={rootWords(file)}
                  used={file.use !== null}
                  enabled={file.enabled}
                  onSwitch={onSwitch}
                  className="min-h-7"
                />
                {(file.linked.length > 0 || file.listedElsewhere.length > 0) && (
                  <LinkedFiles
                    file={file}
                    roots={roots}
                    startOpen={startOpen.includes(file.path)}
                    onSwitch={onSwitch}
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <LeftOut section={section} />
    </>
  );
};
