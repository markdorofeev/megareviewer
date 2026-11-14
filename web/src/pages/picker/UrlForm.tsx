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
}: {
  readonly inputRef: Ref<HTMLInputElement>;
  readonly start: FormStart | null;
  readonly onSubmit: (url: string, ref: PullRequestRef) => void;
  /** The link changed, so a failure about the old one goes. */
  readonly onEdit: () => void;
}) => {
  const [url, setUrl] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
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
          <div
            className={cn(
              "flex h-9 flex-1 items-center gap-2 rounded-md border border-input bg-card px-2.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
              invalid !== null && "border-destructive",
            )}
          >
            <LinkIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              id={`${id}-url`}
              aria-label="Pull request link"
              className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
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
            <KeyHint id="focusLink" />
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
