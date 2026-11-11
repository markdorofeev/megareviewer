import {
  BracesIcon,
  FileCodeIcon,
  FileTextIcon,
  FlaskConicalIcon,
  type LucideIcon,
  PaletteIcon,
  FileIcon as PlainFileIcon,
} from "lucide-react";
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

/**
 * A file's icon in the tree. Decorative: the name beside it carries the extension, so neither its
 * shape nor its color is the only way to tell a type.
 */
export const FileIcon = ({
  path,
  className,
}: {
  readonly path: string;
  readonly className?: string;
}) => {
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
