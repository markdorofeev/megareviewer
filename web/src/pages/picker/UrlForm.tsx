import { LinkIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { type FormEvent, type ReactNode, type Ref, useId, useState } from "react";
import { type PullRequestRef, parsePullRequestUrl } from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { KeyHint } from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";
import { SPIN } from "./PullRequestList.tsx";

export const EMPTY_LINK = "Paste a pull request link first.";
export const NOT_A_LINK =
  "That isn't a pull request link. Use github.com/owner/repo/pull/123 or bitbucket.org/workspace/repo/pull-requests/45.";

/** What the field shows under it while a start from it runs or after it failed. */
export type FormStart =
  | { readonly state: "starting"; readonly message: string; readonly onCancel: () => void }
  | { readonly state: "failed"; readonly message: ReactNode; readonly onRetry: () => void };

const LINK_BUTTON = "h-6 min-w-6 px-1 text-caption";

export const UrlForm = ({
  inputRef,
  start,
  onSubmit,
  onEdit,
  initial,
}: {
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly start: FormStart | null;
  readonly onSubmit: (url: string, ref: PullRequestRef) => void;
  /** The link changed, so a failure about the old one goes. */
  readonly onEdit: () => void;
  /** A link and its problem to start from, for the design system's examples. */
  readonly initial?: { readonly url: string; readonly invalid: string | null };
}) => {
  const [url, setUrl] = useState(initial?.url ?? "");
  const [invalid, setInvalid] = useState<string | null>(initial?.invalid ?? null);
  const id = useId();
  const starting = start?.state === "starting";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (starting) return;
    const trimmed = url.trim();
    if (trimmed === "") {
      setInvalid(EMPTY_LINK);
      return;
    }
    const ref = parsePullRequestUrl(trimmed);
    if (!ref.ok) {
      setInvalid(NOT_A_LINK);
      return;
    }
    onSubmit(trimmed, ref.value);
  };

  return (
    <search>
      <form
        aria-label="Open a pull request by link"
        className="flex flex-col gap-1.5"
        onSubmit={submit}
        noValidate
      >
        <div className="flex gap-2 max-sm:flex-col">
          <div className="relative flex-1">
            <LinkIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              ref={inputRef}
              id={`${id}-url`}
              aria-label="Pull request link"
              className={cn(
                "h-9 w-full min-w-0 rounded-md border border-input bg-card pr-10 pl-8 placeholder:text-muted-foreground",
                invalid !== null && "border-destructive",
              )}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste a GitHub or Bitbucket pull request link"
              value={url}
              readOnly={starting}
              onChange={(event) => {
                setUrl(event.target.value);
                setInvalid(null);
                onEdit();
              }}
              aria-invalid={invalid !== null}
              aria-describedby={`${id}-message`}
            />
            <KeyHint
              id="focusLink"
              className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2"
            />
          </div>
          <Button type="submit" size="lg" className="sm:w-28" aria-busy={starting}>
            {starting ? (
              <>
                <LoaderCircleIcon aria-hidden="true" className={SPIN} />
                Analyzing…
              </>
            ) : (
              "Analyze"
            )}
          </Button>
        </div>
        <div
          id={`${id}-message`}
          role="status"
          className="flex min-h-0 flex-wrap items-center gap-x-2 text-caption"
        >
          {invalid !== null ? (
            <span className="text-destructive">
              <TriangleAlertIcon aria-hidden="true" className="mr-1 inline size-3.5 align-[-2px]" />
              {invalid}
            </span>
          ) : start?.state === "starting" ? (
            <>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <LoaderCircleIcon aria-hidden="true" className={cn("size-3.5", SPIN)} />
                {start.message}
              </span>
              <Button type="button" variant="link" className={LINK_BUTTON} onClick={start.onCancel}>
                Cancel
              </Button>
            </>
          ) : start?.state === "failed" ? (
            <>
              <span className="text-destructive">
                <TriangleAlertIcon
                  aria-hidden="true"
                  className="mr-1 inline size-3.5 align-[-2px]"
                />
                {start.message}
              </span>
              <Button type="button" variant="link" className={LINK_BUTTON} onClick={start.onRetry}>
                Try again
              </Button>
            </>
          ) : null}
        </div>
      </form>
    </search>
  );
};
