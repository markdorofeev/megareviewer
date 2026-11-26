import { FileDiffIcon, FolderGit2Icon, Loader2Icon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Analysis } from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "../../ui/popover.tsx";

/** How much of the repository the review rests on. */
type Reach = "repository" | "downloading" | "pull-request";

const REACH: Readonly<
  Record<Reach, { readonly label: string; readonly title: string; readonly icon: LucideIcon }>
> = {
  repository: {
    label: "Whole repository",
    title: "The whole repository was read",
    icon: FolderGit2Icon,
  },
  downloading: {
    label: "Downloading repository…",
    title: "Downloading the repository",
    icon: Loader2Icon,
  },
  "pull-request": {
    label: "PR only",
    title: "Only the pull request was read",
    icon: FileDiffIcon,
  },
};

const reachOf = (checkout: Analysis["checkout"]): Reach =>
  checkout === "read" ? "repository" : checkout === "downloading" ? "downloading" : "pull-request";

const NoteCode = ({ children }: { readonly children: ReactNode }) => (
  <code className="rounded-sm bg-muted px-1 font-mono text-code-compact">{children}</code>
);

/** A folder by `~` when it's in the home folder, which is known while it's searched. */
const shortFolder = (dir: string, home: string | null): string =>
  home !== null && dir.startsWith(`${home}/`) ? `~${dir.slice(home.length)}` : dir;

const usesOf = (callers: Analysis["unchangedCallers"]): number =>
  callers.reduce((sum, { uses, more }) => sum + uses.length + more, 0);

/** Where the repository was read from, and what was found in it. */
const ReadNote = ({
  analysis,
  home,
  copies,
}: {
  readonly analysis: Analysis;
  readonly home: string | null;
  readonly copies: string | null;
}) => {
  const { checkoutDir, key, unchangedCallers } = analysis;
  const { repo } = key.ref;
  const uses = usesOf(unchangedCallers);
  const own = checkoutDir !== null && copies !== null && checkoutDir.startsWith(`${copies}/`);
  return (
    <p data-slot="checkout-note" className="text-muted-foreground">
      megareviewer read {repo.owner}/{repo.repo} at <NoteCode>{key.headSha.slice(0, 7)}</NoteCode>
      {checkoutDir !== null && (
        <>
          {own ? ", from its own copy in " : ", from your clone in "}
          <NoteCode>{shortFolder(checkoutDir, home)}</NoteCode>
        </>
      )}
      .{" "}
      {uses === 0
        ? "No code outside the pull request uses what it changes."
        : `It found ${uses === 1 ? "1 use" : `${uses} uses`} of what the pull request changes in code outside it, shown on the changes.`}
    </p>
  );
};

/** Why callers outside the pull request aren't shown, or aren't yet. */
const MissingNote = ({
  analysis,
  searched,
  copies,
}: {
  readonly analysis: Analysis;
  readonly searched: string | null | undefined;
  readonly copies: string | null | undefined;
}) => {
  const { checkout, checkoutDir, checkoutError, key } = analysis;
  const { ref, headSha } = key;
  if (checkout === "downloading") {
    return (
      <p data-slot="checkout-note" className="text-muted-foreground">
        Downloading {ref.repo.owner}/{ref.repo.repo} to find the code that calls what this pull
        request changes. It shows on the changes when the download ends.
      </p>
    );
  }
  const folder =
    checkoutDir === null ? "it" : <NoteCode>{shortFolder(checkoutDir, searched ?? null)}</NoteCode>;
  const notDownloaded = copies === null && (
    <>
      It didn't download it, because it was started with <NoteCode>--no-download</NoteCode>.{" "}
    </>
  );
  return (
    <p data-slot="checkout-note" className="text-muted-foreground">
      Code outside the pull request that calls what it changes isn't shown:{" "}
      {checkout === "download-failed" ? (
        <>
          the repository couldn't be downloaded. {checkoutError} Open the pull request again to try
          again
          {checkoutDir !== null && (
            <>
              , or run <NoteCode>git fetch</NoteCode> in {folder} first
            </>
          )}
          .
        </>
      ) : checkout === "missing-commit" ? (
        <>
          the clone on this machine doesn't have the head commit{" "}
          <NoteCode>{headSha.slice(0, 7)}</NoteCode>. {notDownloaded}Run{" "}
          <NoteCode>git fetch</NoteCode> in {folder}
          {ref.repo.host === "github" && (
            <>
              , or <NoteCode>git fetch origin pull/{ref.number}/head</NoteCode> for a pull request
              from a fork
            </>
          )}
          , then open the pull request again.
        </>
      ) : (
        <>
          megareviewer found no clone of {ref.repo.owner}/{ref.repo.repo} on this machine.{" "}
          {searched === null && (
            <>
              It didn't look in your home folder, because it was started with{" "}
              <NoteCode>--no-search</NoteCode>.{" "}
            </>
          )}
          {typeof searched === "string" && "It looked in your home folder. "}
          {notDownloaded}
          Start it in a clone, or pass <NoteCode>--checkout &lt;dir&gt;</NoteCode>, then open the
          pull request again.
        </>
      )}
    </p>
  );
};

/**
 * Whether the review rests on the whole repository or on the pull request alone, in the header's
 * byline, opening where it was read from or why it wasn't. Shown once the code's stages are done:
 * before that, a repository about to be downloaded reads as one that wasn't found.
 */
export const RepositoryStatus = ({
  analysis,
  searched,
  copies,
}: {
  readonly analysis: Analysis;
  /** The folder searched for clones, null when that's off; undefined until the status is read. */
  readonly searched: string | null | undefined;
  /** The folder megareviewer's copies are in, null when downloading is off; undefined as above. */
  readonly copies: string | null | undefined;
}) => {
  if (analysis.status !== "complete") return null;
  const reach = reachOf(analysis.checkout);
  const { label, title, icon: Icon } = REACH[reach];
  return (
    <>
      {" "}
      <span aria-hidden="true">·</span>{" "}
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              className={cn(
                "-mx-1.5 h-6 gap-1.5 px-1.5 text-ui font-normal",
                reach === "pull-request" ? "font-medium text-foreground" : "text-muted-foreground",
              )}
              data-slot="repository-status"
              data-reach={reach}
            >
              <Icon
                aria-hidden="true"
                className={cn(
                  "size-3.5",
                  reach === "downloading" &&
                    "animate-spin motion-reduce:animate-[spin_3s_linear_infinite]",
                )}
              />
              {label}
            </Button>
          }
        />
        <PopoverContent align="start" className="w-96">
          <PopoverTitle>{title}</PopoverTitle>
          {reach === "repository" ? (
            <ReadNote analysis={analysis} home={searched ?? null} copies={copies ?? null} />
          ) : (
            <MissingNote analysis={analysis} searched={searched} copies={copies} />
          )}
        </PopoverContent>
      </Popover>
    </>
  );
};
