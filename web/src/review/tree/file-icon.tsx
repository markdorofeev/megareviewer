import {
  BracesIcon,
  FileCodeIcon,
  FileMinusIcon,
  FilePlusIcon,
  FileTextIcon,
  FlaskConicalIcon,
  type LucideIcon,
  PaletteIcon,
  FileIcon as PlainFileIcon,
} from "lucide-react";
import type { FileStatus } from "../../../../src/domain/diff/index.ts";
import { FILE_STATUS } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { type FileFamily, type FileRole, fileFamily, fileRole } from "./file-kind.ts";

const SHAPES: Readonly<Record<FileRole, LucideIcon>> = {
  test: FlaskConicalIcon,
  code: FileCodeIcon,
  data: BracesIcon,
  docs: FileTextIcon,
  style: PaletteIcon,
  other: PlainFileIcon,
};

// The syntax colors, the hues the code beside the tree already uses.
const TONES: Readonly<Record<FileFamily, string>> = {
  python: "text-syntax-function",
  script: "text-syntax-number",
  data: "text-syntax-string",
  markup: "text-syntax-keyword",
  plain: "text-muted-foreground",
};

// A new or deleted file's icon says so instead of its type: the plus or minus is the glyph that
// goes with the color.
const MARKS: Readonly<Partial<Record<FileStatus, LucideIcon>>> = {
  added: FilePlusIcon,
  deleted: FileMinusIcon,
};

/**
 * A file's icon. Decorative: the name beside it carries the extension, and a hidden word its
 * status, so neither the shape nor the color is the only way to tell them.
 */
export const FileIcon = ({
  path,
  status,
  className,
}: {
  readonly path: string;
  readonly status?: FileStatus;
  readonly className?: string;
}) => {
  const style = status === undefined ? null : FILE_STATUS[status];
  const Mark = status === undefined ? undefined : MARKS[status];
  if (style?.kind === "mark" && Mark !== undefined) {
    return (
      <Mark
        aria-hidden="true"
        data-status={status}
        className={cn("size-3.5 shrink-0", style.tone, className)}
      />
    );
  }
  const role = fileRole(path);
  const Shape = SHAPES[role];
  return (
    <Shape
      aria-hidden="true"
      data-role={role}
      className={cn("size-3.5 shrink-0", TONES[fileFamily(path)], className)}
    />
  );
};
