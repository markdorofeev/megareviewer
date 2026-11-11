import { type ReactNode, useId, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { PublicationVerdict } from "../../../../src/domain/review/index.ts";
import { useShortcuts } from "../../lib/keymap.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { Label } from "../../ui/label.tsx";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "../../ui/popover.tsx";
import { RadioGroup, RadioGroupItem } from "../../ui/radio-group.tsx";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "../../ui/sheet.tsx";
import { Textarea } from "../../ui/textarea.tsx";
import { KeyHint } from "../shell/key-hint.tsx";

/** A comment written on lines, waiting to be published with the review. */
export interface PendingComment {
  readonly id: string;
  readonly path: string;
  readonly line: number;
  readonly excerpt: string;
}

const VERDICTS: readonly {
  readonly value: PublicationVerdict;
  readonly label: string;
  readonly glyph: string;
  readonly body: string;
  readonly tint: string;
  readonly needsReviewer: boolean;
}[] = [
  {
    value: "comment",
    label: "Comment",
    glyph: "•",
    body: "Post the comments without a verdict.",
    tint: "has-data-checked:border-review-commented has-data-checked:bg-review-commented-bg",
    needsReviewer: false,
  },
  {
    value: "approve",
    label: "Approve",
    glyph: "✓",
    body: "The change can merge.",
    tint: "has-data-checked:border-review-approved has-data-checked:bg-review-approved-bg",
    needsReviewer: true,
  },
  {
    value: "request_changes",
    label: "Request changes",
    glyph: "✕",
    body: "The author has to address the comments first.",
    tint: "has-data-checked:border-review-changes has-data-checked:bg-review-changes-bg",
    needsReviewer: true,
  },
];

const NARROW = "(max-width: 640px)";
const subscribeNarrow = (listener: () => void) => {
  const media = window.matchMedia(NARROW);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};
const isNarrow = () => window.matchMedia(NARROW).matches;

export interface ReviewSubmitPanelProps {
  readonly pending: readonly PendingComment[];
  /** Decisions given a verdict, of all of them. */
  readonly decided: readonly [number, number];
  /** False on the author's own PR: hosts don't let authors approve or reject it. */
  readonly canApprove: boolean;
  readonly onSubmit: (verdict: PublicationVerdict, body: string) => Promise<void> | void;
  readonly defaultVerdict?: PublicationVerdict;
  /** ⇧R opens this panel; off when another panel on the page has it. */
  readonly shortcut?: boolean;
}

/** Publishing the review: what will be posted, a summary, a verdict, then ⌘↵. */
export const ReviewSubmitPanel = ({
  pending,
  decided,
  canApprove,
  onSubmit,
  defaultVerdict = "comment",
  shortcut = true,
}: ReviewSubmitPanelProps) => {
  const [open, setOpen] = useState(false);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow);
  useShortcuts({ openReview: () => setOpen(true) }, shortcut);

  const trigger = (
    <Button>
      Publish
      {shortcut && <KeyHint id="openReview" />}
    </Button>
  );
  const body = (
    <PanelBody
      // The title names the dialog, so it's the Sheet's or the Popover's own.
      title={
        narrow ? (
          <SheetTitle className="text-heading font-semibold">Publish review</SheetTitle>
        ) : (
          <PopoverTitle className="text-heading font-semibold">Publish review</PopoverTitle>
        )
      }
      pending={pending}
      decided={decided}
      canApprove={canApprove}
      defaultVerdict={canApprove ? defaultVerdict : "comment"}
      onCancel={() => setOpen(false)}
      onSubmit={async (verdict, text) => {
        await onSubmit(verdict, text);
        setOpen(false);
        toast.success("Review published");
      }}
    />
  );

  return narrow ? (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={trigger} />
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto p-4">
        {body}
      </SheetContent>
    </Sheet>
  ) : (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="end" className="w-[420px] p-4">
        {body}
      </PopoverContent>
    </Popover>
  );
};

const PanelBody = ({
  title,
  pending,
  decided,
  canApprove,
  defaultVerdict,
  onCancel,
  onSubmit,
}: {
  readonly title: ReactNode;
  readonly pending: readonly PendingComment[];
  readonly decided: readonly [number, number];
  readonly canApprove: boolean;
  readonly defaultVerdict: PublicationVerdict;
  readonly onCancel: () => void;
  readonly onSubmit: (verdict: PublicationVerdict, body: string) => Promise<void>;
}) => {
  const [verdict, setVerdict] = useState<PublicationVerdict>(defaultVerdict);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");
  const summaryId = useId();

  const submit = async () => {
    if (state === "submitting") return;
    setState("submitting");
    try {
      await onSubmit(verdict, text.trim());
      setState("idle");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 pr-8">
        {title}
        <span className="tabular text-caption text-muted-foreground">
          {decided[0]} of {decided[1]} decisions given
        </span>
      </div>
      <section aria-label="Comments to post" className="flex flex-col gap-1">
        <h3 className="text-caption font-medium text-muted-foreground">
          {pending.length === 0
            ? "No line comments"
            : `${pending.length} line ${pending.length === 1 ? "comment" : "comments"}`}
        </h3>
        {pending.length > 0 && (
          <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto">
            {pending.map((comment) => (
              <li
                key={comment.id}
                className="rounded-md border-l-3 border-l-review-pending bg-surface-subtle px-2 py-1"
              >
                <span className="font-mono text-code-compact text-muted-foreground">
                  {comment.path}:{comment.line}
                </span>
                <p className="truncate">{comment.excerpt}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={summaryId}>Summary</Label>
        <Textarea
          id={summaryId}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onSubmitShortcut={() => void submit()}
          placeholder="Optional, posted with the review"
        />
      </div>
      <RadioGroup
        value={verdict}
        onValueChange={(value) => {
          const chosen = VERDICTS.find((option) => option.value === value);
          if (chosen !== undefined) setVerdict(chosen.value);
        }}
        aria-label="Verdict"
        className="flex flex-col gap-2"
      >
        {VERDICTS.map((option) => {
          const blocked = option.needsReviewer && !canApprove;
          return (
            <Label
              key={option.value}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3 leading-snug font-normal",
                !blocked && option.tint,
                blocked && "opacity-60",
              )}
            >
              <RadioGroupItem value={option.value} disabled={blocked} className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">
                  <span aria-hidden="true">{option.glyph} </span>
                  {option.label}
                </span>
                <span className="text-caption text-muted-foreground">
                  {blocked ? "Not on your own pull request." : option.body}
                </span>
              </span>
            </Label>
          );
        })}
      </RadioGroup>
      {state === "error" && (
        <p role="alert" className="text-caption text-destructive">
          ✕ Not published. Nothing was posted twice; try again.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={state === "submitting"}>
          {state === "submitting" ? "Publishing…" : "Publish"}
          <KeyHint id="submit" />
        </Button>
      </div>
    </div>
  );
};
