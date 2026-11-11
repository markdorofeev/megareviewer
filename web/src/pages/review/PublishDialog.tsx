import { useEffect, useId, useRef, useState } from "react";
import type {
  AnalysisId,
  HunkComment,
  Publication,
  PublicationReceipt,
  PublicationVerdict,
} from "../../../../src/domain/review/index.ts";
import { type ApiError, errorMessage, useApi, useMutation } from "../../api/index.ts";
import { type StatusStyle, VERDICT_STATUS } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { DANGER, WARNING } from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";
import { Label } from "../../ui/label.tsx";
import { RadioGroup, RadioGroupItem } from "../../ui/radio-group.tsx";
import { StatusBadge } from "../../ui/status-badge.tsx";
import { Textarea } from "../../ui/textarea.tsx";
import { Dialog } from "./Dialog.tsx";

/** The preview refreshes once typing in the summary pauses for this long. */
export const PREVIEW_DELAY_MS = 400;

const VERDICT_NAMES: Readonly<Record<PublicationVerdict, string>> = {
  approve: "Approve",
  request_changes: "Request changes",
  comment: "Comment",
};

const VERDICT_OPTIONS = ["approve", "request_changes", "comment"] as const;

const PUBLICATION_STATUS: Readonly<Record<PublicationVerdict, StatusStyle>> = {
  approve: { ...VERDICT_STATUS.approved, label: "Approve" },
  request_changes: { ...VERDICT_STATUS.rejected, label: "Request changes" },
  comment: {
    label: "Comment",
    glyph: "•",
    className: "text-review-commented bg-review-commented-bg border-review-commented/25",
  },
};

/** Text as it will be posted: its own line breaks, never HTML. */
const POSTED = "whitespace-pre-wrap break-words";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Shows exactly what will be posted, then posts it after the reviewer confirms. */
export const PublishDialog = ({
  analysisId,
  isAuthor,
  pendingCount,
  hunkComments,
  chooseVerdict,
  onClose,
  onPublished,
}: {
  readonly analysisId: AnalysisId;
  readonly isAuthor: boolean;
  /** Decisions without a verdict; they're listed as not reviewed. */
  readonly pendingCount: number;
  /** Comments the reviewer wrote on hunk lines. */
  readonly hunkComments: readonly HunkComment[];
  /** No decisions to imply a verdict, so the reviewer picks one. */
  readonly chooseVerdict: boolean;
  readonly onClose: () => void;
  readonly onPublished: (receipt: PublicationReceipt) => void;
}) => {
  const { client } = useApi();
  const id = useId();
  const [summary, setSummary] = useState("");
  const [chosen, setChosen] = useState<PublicationVerdict>("comment");
  const verdict = chooseVerdict && !isAuthor ? chosen : null;
  const [preview, setPreview] = useState<Publication | null>(null);
  const [previewError, setPreviewError] = useState<ApiError | null>(null);
  const [confirmStale, setConfirmStale] = useState(false);
  const [allowStale, setAllowStale] = useState(false);
  const publish = useMutation(client.publish);
  const loaded = useRef(false);

  useEffect(() => {
    let current = true;
    const timer = setTimeout(
      () =>
        void client
          .previewPublication(analysisId, { summary, hunkComments, verdict })
          .then((result) => {
            if (!current) return;
            loaded.current = true;
            setPreview(result.ok ? result.value : null);
            setPreviewError(result.ok ? null : result.error);
          }),
      // The first preview loads at once; later ones wait for typing to pause.
      loaded.current ? PREVIEW_DELAY_MS : 0,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [analysisId, client, summary, hunkComments, verdict]);

  const send = async (stale: boolean) => {
    setAllowStale(stale);
    setConfirmStale(false);
    const result = await publish.run(analysisId, {
      summary,
      allowStale: stale,
      hunkComments,
      verdict,
    });
    if (result.ok) {
      onPublished(result.value);
    } else if (result.error.code === "stale-analysis") {
      publish.reset();
      setConfirmStale(true);
    }
  };

  return (
    <Dialog title="Publish the review" onClose={onClose} className="sm:max-w-2xl">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-summary`}>Summary</Label>
        <Textarea
          id={`${id}-summary`}
          rows={4}
          data-autofocus
          placeholder="What you'd like the author to know overall (optional)"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
      </div>

      {chooseVerdict && !isAuthor && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 font-medium">Verdict</legend>
          <RadioGroup
            value={chosen}
            onValueChange={(value) => {
              const option = VERDICT_OPTIONS.find((each) => each === value);
              if (option !== undefined) setChosen(option);
            }}
            className="flex flex-wrap gap-4"
          >
            {VERDICT_OPTIONS.map((option) => (
              <Label key={option}>
                <RadioGroupItem value={option} />
                {VERDICT_NAMES[option]}
              </Label>
            ))}
          </RadioGroup>
        </fieldset>
      )}

      <section
        aria-labelledby={`${id}-preview`}
        aria-busy={preview === null}
        className="flex flex-col gap-2 rounded-lg border bg-surface-subtle p-3"
      >
        <h3 id={`${id}-preview`} className="font-semibold">
          What will be posted
        </h3>
        {previewError !== null ? (
          <p className={DANGER} role="alert">
            Couldn't build the preview. {errorMessage(previewError)}
          </p>
        ) : preview === null ? (
          <p className="text-muted-foreground">Building the preview…</p>
        ) : (
          <>
            <p className="flex items-center gap-2">
              Verdict: <StatusBadge status={PUBLICATION_STATUS[preview.verdict]} />
            </p>
            {isAuthor && preview.verdict === "comment" && (
              <p className="text-muted-foreground">
                You opened this pull request, so the review is posted as a comment: hosts don't let
                authors approve their own pull requests or request changes on them.
              </p>
            )}
            {pendingCount > 0 && (
              <p className={WARNING}>
                {plural(pendingCount, "decision isn't", "decisions aren't")} reviewed yet. The
                summary lists {pendingCount === 1 ? "it" : "them"} as not reviewed.
              </p>
            )}
            <h4 className="font-medium">
              {plural(preview.comments.length, "inline comment", "inline comments")}
            </h4>
            {preview.comments.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {preview.comments.map((comment) => (
                  <li
                    key={comment.key}
                    className="rounded-md border-l-3 border-l-review-pending bg-background px-2 py-1"
                  >
                    <code className="font-mono text-code-compact text-muted-foreground">
                      {comment.path}:{comment.line}
                      {comment.side === "old" ? " (old side)" : ""}
                    </code>
                    <p className={POSTED}>{comment.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <h4 className="font-medium">Summary comment</h4>
            <p className={POSTED}>{preview.summary}</p>
          </>
        )}
      </section>

      {confirmStale ? (
        <div className={cn(WARNING, "flex flex-col gap-2")} role="alert">
          <p>This PR changed since the analysis. Publish anyway?</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmStale(false)}>
              Cancel
            </Button>
            <Button onClick={() => void send(true)}>Publish anyway</Button>
          </div>
        </div>
      ) : (
        <>
          {publish.error !== null && (
            <div className={DANGER} role="alert">
              <p>Couldn't publish. {errorMessage(publish.error)}</p>
              <p className="text-muted-foreground">
                Retrying is safe: comments that were already posted aren't posted again.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={publish.pending || preview === null}
              onClick={() => void send(allowStale)}
            >
              {publish.pending ? "Publishing…" : publish.error !== null ? "Retry" : "Publish"}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
};
