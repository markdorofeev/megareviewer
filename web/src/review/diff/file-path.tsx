import { useId, useState } from "react";
import {
  type FileChange,
  type FileStatus,
  isTestFile,
  type UnchangedCallers,
} from "../../../../src/domain/diff/index.ts";
import { FILE_STATUS } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { FileIcon } from "../tree/file-icon.tsx";

/** A path with its directory muted, so the file's name stands out and its place still shows. */
const SplitPath = ({ path, name }: { readonly path: string; readonly name?: string }) => {
  const cut = path.lastIndexOf("/") + 1;
  return (
    <>
      {cut > 0 && <span className="text-muted-foreground">{path.slice(0, cut)}</span>}
      <span data-slot="file-name" className={cn("font-medium", name)}>
        {path.slice(cut)}
      </span>
    </>
  );
};

/**
 * A file's path; a renamed file's old path, an arrow, and its new one. A new or deleted file has
 * its mark: the status icon before the path, the name in the status color, and the word hidden
 * after it.
 */
export const FilePath = ({
  file,
  status,
  className,
}: {
  readonly file: Pick<FileChange, "path" | "oldPath">;
  readonly status?: FileStatus;
  readonly className?: string;
}) => {
  const style = status === undefined ? null : FILE_STATUS[status];
  const mark = style?.kind === "mark" ? style : null;
  return (
    <span data-slot="file-path" className={cn("min-w-0 break-all font-mono text-code", className)}>
      {mark !== null && (
        <FileIcon path={file.path} status={status} className="mr-1 inline-block align-[-2px]" />
      )}
      {file.oldPath !== null && file.oldPath !== file.path ? (
        <>
          <span className="text-muted-foreground">{file.oldPath}</span>{" "}
          <span aria-hidden="true">→</span>
          <span className="sr-only">renamed to</span>{" "}
          <SplitPath path={file.path} name={mark?.name} />
        </>
      ) : (
        <SplitPath path={file.path} name={mark?.name} />
      )}
      {mark !== null && <span className="sr-only">, {mark.label}</span>}
    </span>
  );
};

/** A renamed file's status as a word chip. A new or deleted file is marked by `FilePath`. */
export const FileStatusChip = ({ status }: { readonly status: FileStatus }) => {
  const style = FILE_STATUS[status];
  return style?.kind !== "chip" ? null : (
    <span
      data-slot="file-status"
      className={cn(
        "shrink-0 rounded-full border px-1.5 text-caption font-medium leading-4",
        style.className,
      )}
    >
      {style.label}
    </span>
  );
};

const places = (count: number, noun: "place" | "test"): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * "Used unchanged in 3 places and 1 test": code outside the pull request that calls what a part
 * changes, where a regression would show. A click lists each use with the lines around it.
 */
export const UnchangedUses = ({
  callers,
  named,
}: {
  readonly callers: UnchangedCallers;
  /** Name the definition, when the part changes several that have callers. */
  readonly named: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const { uses, more } = callers;
  const tests = uses.filter((use) => isTestFile(use.path)).length;
  const code = uses.length - tests;
  const counts = [
    ...(code > 0 ? [places(code, "place")] : []),
    ...(tests > 0 ? [places(tests, "test")] : []),
  ];
  const summary = `${counts.join(" and ")}${more > 0 ? `, and ${more} more` : ""}`;
  return (
    <div data-slot="unchanged-uses" className="border-b bg-surface-subtle px-3 py-1.5">
      <p>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen(!open)}
          className="min-h-6 rounded-sm text-primary underline-offset-2 hover:underline"
        >
          {named && (
            <>
              <code className="font-mono text-code-compact">{callers.symbol}</code>{" "}
            </>
          )}
          {named ? "used" : "Used"} unchanged in {summary}
        </button>
      </p>
      {open && (
        <ul id={listId} className="mt-1.5 flex flex-col gap-2">
          {uses.map((use) => (
            <li key={`${use.path}:${use.line}`} data-slot="unchanged-use">
              <p
                data-slot="unchanged-place"
                className="font-mono text-code-compact text-muted-foreground"
              >
                <span className="text-foreground">{use.path}</span>:{use.line}
                {use.use === "type" && <span> type</span>}
              </p>
              <pre className="overflow-x-auto rounded-md border bg-background py-1 font-mono text-code-compact">
                {use.excerpt.lines.map((text, at) => {
                  const line = use.excerpt.start + at;
                  const used = line === use.line;
                  return (
                    <span
                      key={line}
                      data-slot="unchanged-line"
                      data-used={used || undefined}
                      className={cn("block pr-3", used && "bg-diff-hunk-bg text-diff-hunk-fg")}
                    >
                      <span className="tabular inline-block w-12 select-none pr-3 text-right text-diff-gutter-fg">
                        {line}
                      </span>
                      {text}
                    </span>
                  );
                })}
              </pre>
            </li>
          ))}
          {more > 0 && <li className="text-muted-foreground">and {more} more</li>}
        </ul>
      )}
    </div>
  );
};
