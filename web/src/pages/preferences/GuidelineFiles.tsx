import { FileTextIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import {
  GUIDELINE_PATHS,
  type GuidelineFile,
  type GuidelinePath,
  MAX_GUIDELINE_BYTES,
} from "../../../../src/domain/review/index.ts";
import { Switch } from "../../ui/switch.tsx";
import { formatBytes, sentence } from "./view.ts";

const LOOKED_FOR = new Intl.ListFormat("en", { type: "disjunction" }).format(GUIDELINE_PATHS);

const File = ({
  file,
  repository,
  onSwitch,
}: {
  readonly file: GuidelineFile;
  readonly repository: string;
  readonly onSwitch: (path: GuidelinePath, enabled: boolean) => Promise<string | null>;
}) => {
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <li data-slot="guideline-file" className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
      <FileTextIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 font-mono text-code-compact break-all">{file.path}</span>
      <span className="tabular shrink-0 text-caption text-muted-foreground">
        {formatBytes(file.bytes)}
      </span>
      {file.tooLarge ? (
        <span className="text-caption text-muted-foreground">
          too large to send: a guideline file can be {formatBytes(MAX_GUIDELINE_BYTES)}
        </span>
      ) : (
        <Switch
          checked={file.enabled}
          aria-label={`Read ${file.path} in AI reviews of ${repository}`}
          onCheckedChange={async (checked) => {
            setFailure(null);
            setFailure(await onSwitch(file.path, checked));
          }}
        />
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

/**
 * A repository's guideline files with their size and switch; one too large to send says so and
 * has no switch. Without any read, why.
 */
export const GuidelineFiles = ({
  files,
  note,
  repository,
  onSwitch,
}: {
  /** null when they couldn't be looked for, with why in `note`. */
  readonly files: readonly GuidelineFile[] | null;
  readonly note: string | null;
  /** "acme/shop", for the switches' names. */
  readonly repository: string;
  readonly onSwitch: (path: GuidelinePath, enabled: boolean) => Promise<string | null>;
}) => (
  <div data-slot="guideline-files" className="flex flex-col gap-1 border-t px-4 py-3">
    <h3 className="text-caption font-medium text-muted-foreground">
      Guideline files, read at the base commit of the pull request
    </h3>
    {files === null ? (
      <p className="text-caption text-muted-foreground">
        {sentence(note ?? "Couldn't look for them")}
      </p>
    ) : files.length === 0 ? (
      <p className="text-caption text-muted-foreground">
        None at the repository's root, where megareviewer looks for {LOOKED_FOR}.
      </p>
    ) : (
      <ul className="flex flex-col">
        {files.map((file) => (
          <File key={file.path} file={file} repository={repository} onSwitch={onSwitch} />
        ))}
      </ul>
    )}
  </div>
);
