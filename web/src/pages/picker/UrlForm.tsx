import { type FormEvent, type Ref, useId, useState } from "react";
import { parsePullRequestUrl } from "../../../../src/domain/review/index.ts";
import { type ApiError, errorMessage } from "../../api/index.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { Input } from "../../ui/input.tsx";
import { Kbd } from "../../ui/kbd.tsx";
import { Label } from "../../ui/label.tsx";

const UNSUPPORTED = errorMessage({ code: "unsupported-url", message: "" });

export const UrlForm = ({
  inputRef,
  pending,
  error,
  onSubmit,
}: {
  readonly inputRef: Ref<HTMLInputElement>;
  readonly pending: boolean;
  /** The last failed submit. */
  readonly error: ApiError | null;
  readonly onSubmit: (url: string) => void;
}) => {
  const [url, setUrl] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const id = useId();
  const empty = url.trim() === "";
  const valid = !empty && parsePullRequestUrl(url).ok;
  // A failed submit's error stays until the URL is edited.
  const submitError = error !== null && submitted === url ? errorMessage(error) : null;
  const problem = empty || valid ? submitError : UNSUPPORTED;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || pending) return;
    setSubmitted(url);
    onSubmit(url.trim());
  };

  return (
    <form className="flex flex-col gap-1.5" onSubmit={submit} noValidate>
      <Label htmlFor={`${id}-url`}>Pull request URL</Label>
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          id={`${id}-url`}
          className="h-9 flex-1"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://github.com/owner/repo/pull/123"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          aria-invalid={!empty && !valid}
          aria-describedby={`${id}-hint`}
        />
        <Button type="submit" size="lg" disabled={!valid || pending}>
          {pending ? "Starting…" : "Analyze"}
        </Button>
      </div>
      <p
        id={`${id}-hint`}
        className={cn(
          "text-caption",
          problem === null ? "text-muted-foreground" : "text-destructive",
        )}
        role="status"
      >
        {problem === null ? (
          <>
            Paste a GitHub or Bitbucket Cloud pull request link. Press <Kbd>/</Kbd> to focus.
          </>
        ) : (
          <>
            <span aria-hidden="true">✕ </span>
            {problem}
          </>
        )}
      </p>
    </form>
  );
};
