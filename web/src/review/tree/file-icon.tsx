import type { FileStatus } from "../../../../src/domain/diff/index.ts";
import { cn } from "../../lib/utils.ts";
import { type FolderKind, fileKind, type IconName } from "./file-kind.ts";

// IntelliJ IDEA's icons, unmodified (icons/PROVENANCE.md). Their colors are the icons' own, so they
// load as images rather than as markup in our source.
const URLS: Readonly<Record<string, string>> = import.meta.glob<string>("./icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

const url = (name: IconName | "junitTestMark", dark: boolean): string =>
  URLS[`./icons/${name}${dark ? "_dark" : ""}.svg`] ?? "";

/** Both variants, the dark one shown under `.dark`, so switching the theme needs no render. */
const Variants = ({
  name,
  className,
}: {
  readonly name: IconName | "junitTestMark";
  readonly className?: string;
}) => (
  <>
    <img
      src={url(name, false)}
      alt=""
      draggable={false}
      className={cn("block size-4 dark:hidden", className)}
    />
    <img
      src={url(name, true)}
      alt=""
      draggable={false}
      className={cn("hidden size-4 dark:block", className)}
    />
  </>
);

/** A file's icon. Decorative: the row's name says what the file is and its status. */
export const FileIcon = ({
  path,
  status,
  className,
}: {
  readonly path: string;
  readonly status?: FileStatus;
  readonly className?: string;
}) => {
  const kind = fileKind(path, status);
  return (
    <span
      aria-hidden="true"
      data-icon={kind.icon}
      {...(kind.testMark ? { "data-test-mark": "" } : {})}
      className={cn("relative inline-block size-4 shrink-0", className)}
    >
      <Variants name={kind.icon} />
      {kind.testMark && <Variants name="junitTestMark" className="absolute inset-0" />}
    </span>
  );
};

export const FolderIcon = ({ kind }: { readonly kind: FolderKind }) => (
  <span aria-hidden="true" data-icon={kind} className="inline-block size-4 shrink-0">
    <Variants name={kind} />
  </span>
);
