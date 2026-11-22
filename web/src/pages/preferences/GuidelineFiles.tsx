import { FileTextIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import {
  GUIDELINE_PATHS,
  type GuidelineFile,
  type GuidelinePath,
  MAX_GUIDELINE_BYTES,
} from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { Switch } from "../../ui/switch.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip.tsx";
import { formatBytes, sentence } from "./view.ts";

const LOOKED_FOR = `megareviewer looks for ${new Intl.ListFormat("en", { type: "disjunction" }).format(GUIDELINE_PATHS)}.`;

const File = ({
  file,
  onSwitch,
}: {
  readonly file: GuidelineFile;
  readonly onSwitch: (path: GuidelinePath, enabled: boolean) => Promise<string | null>;
}) => {
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <li
      data-slot="guideline-file"
      className="flex min-h-11 flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-2"
    >
      <FileTextIcon aria-hidden="true" className="size-[15px] shrink-0 text-muted-foreground" />
      <span className="min-w-0 font-mono text-code-compact break-all">{file.path}</span>
      <span className="tabular shrink-0 text-caption text-muted-foreground">
        {formatBytes(file.bytes)}
      </span>
      {file.tooLarge ? (
        <span className="ml-auto text-caption text-muted-foreground">
          Too large to send: a guideline file can be {formatBytes(MAX_GUIDELINE_BYTES)}
        </span>
      ) : (
        <span className="ml-auto flex items-center gap-2">
          <Switch
            checked={file.enabled}
            aria-label={`Use ${file.path} in AI reviews`}
            onCheckedChange={async (checked) => {
              setFailure(null);
              setFailure(await onSwitch(file.path, checked));
            }}
          />
          {/* The state in words, so it never rests on the thumb's place or its color. */}
          <span
            aria-hidden="true"
            className={cn(
              "text-caption",
              file.enabled ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {file.enabled ? "Followed by AI reviews" : "Ignored"}
          </span>
        </span>
      )}
      {failure !== null && (
        <p role="alert" className="basis-full text-caption text-destructive">
          <TriangleAlertIcon aria-hidden="true" className="mr-1 inline size-3.5 align-[-2px]" />
          {failure}
        </p>
      )}
    </li>
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

/**
 * A repository's guideline files with their size, switch and what the switch means; one too large
 * to send says so and has no switch. Without any read, why.
 */
export const GuidelineFiles = ({
  files,
  note,
  onSwitch,
}: {
  /** null when they couldn't be looked for, with why in `note`. */
  readonly files: readonly GuidelineFile[] | null;
  readonly note: string | null;
  readonly onSwitch: (path: GuidelinePath, enabled: boolean) => Promise<string | null>;
}) =>
  files === null ? (
    <p className="text-ui text-muted-foreground">{sentence(note ?? "Couldn't look for them")}</p>
  ) : files.length === 0 ? (
    <NoneFound />
  ) : (
    <>
      <p className="mb-2.5 max-w-[620px] text-ui text-muted-foreground">
        At the repository root, read at each pull request's base commit. When a file is on, AI
        reviews follow it the same way as your preferences; when off, it is ignored.
      </p>
      <ul
        data-slot="guideline-files"
        className="divide-y overflow-hidden rounded-lg border bg-card"
      >
        {files.map((file) => (
          <File key={file.path} file={file} onSwitch={onSwitch} />
        ))}
      </ul>
    </>
  );
