import { useId, useState } from "react";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { Textarea } from "../../ui/textarea.tsx";
import { KeyHint } from "../shell/key-hint.tsx";

export interface CommentComposerProps {
  /** What the comment is on, e.g. "src/retry.ts:41–43". */
  readonly anchor: string;
  readonly onSubmit: (body: string) => Promise<void> | void;
  readonly onCancel?: () => void;
  readonly defaultValue?: string;
  /** Takes the focus when it opens, as it does when the reviewer asked to write. */
  readonly autoFocus?: boolean;
  readonly className?: string;
}

/** A comment on lines or a decision: Markdown, ⌘↵ to send, Esc to cancel. */
export const CommentComposer = ({
  anchor,
  onSubmit,
  onCancel,
  defaultValue = "",
  autoFocus = true,
  className,
}: CommentComposerProps) => {
  const [body, setBody] = useState(defaultValue);
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");
  const id = useId();
  const empty = body.trim() === "";

  const submit = async () => {
    if (empty || state === "submitting") return;
    setState("submitting");
    try {
      await onSubmit(body.trim());
      setBody("");
      setState("idle");
    } catch {
      setState("error");
    }
  };

  return (
    <form
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-l-3 border-l-review-pending bg-thread-bg p-3",
        className,
      )}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={id} className="text-caption text-muted-foreground">
        Comment on <span className="font-mono">{anchor}</span>
      </label>
      <Textarea
        id={id}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onSubmitShortcut={() => void submit()}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onCancel !== undefined) {
            event.preventDefault();
            onCancel();
          }
        }}
        placeholder="Markdown is fine"
        aria-invalid={state === "error" || undefined}
        disabled={state === "submitting"}
        autoFocus={autoFocus}
      />
      {state === "error" && (
        <p role="alert" className="text-caption text-destructive">
          ✕ Not saved. Try again; your text is still here.
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        {onCancel !== undefined && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm" disabled={empty || state === "submitting"}>
          {state === "submitting" ? "Saving…" : "Comment"}
          <KeyHint id="submit" />
        </Button>
      </div>
    </form>
  );
};
