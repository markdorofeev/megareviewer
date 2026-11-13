import { useEffect, useId, useState } from "react";
import type {
  AnalysisId,
  HunkComment,
  Publication,
  PublicationReceipt,
  PublicationVerdict,
} from "../../../../src/domain/review/index.ts";
import { type ApiError, errorMessage, useApi, useMutation } from "../../api/index.ts";
import { cn } from "../../lib/utils.ts";
import { DANGER, WARNING } from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";
import { Textarea } from "../../ui/textarea.tsx";
import { Dialog } from "./Dialog.tsx";
import { Segmented } from "./Segmented.tsx";

const VERDICTS: readonly { readonly value: PublicationVerdict; readonly label: string }[] = [
  { value: "comment", label: "Comment" },
  { value: "approve", label: "Approve" },
  { value: "request_changes", label: "Request changes" },
];

/** Text as it will be posted: its own line breaks, never HTML. */
const POSTED = "whitespace-pre-wrap break-words";

/** "Publish 2 comments", or "Publish the review" when there are none, as with only a verdict. */
const publishLabel = (count: number): string =>
  count === 0 ? "Publish the review" : `Publish ${count} ${count === 1 ? "comment" : "comments"}`;

/**
 * The comments as they will be posted, the verdict the reviewer picks, an optional summary, and a
 * button that says what it posts. Nothing is posted that isn't shown here: the summary goes as
 * written. An author can only comment, as hosts don't let them approve their own PR.
 */
export const PublishDialog = ({
  analysisId,
  hunkComments,
  isAuthor,
  onClose,
  onPublished,
}: {
  readonly analysisId: AnalysisId;
  readonly hunkComments: readonly HunkComment[];
  /** The reviewer wrote the PR, so the review can only comment. */
  readonly isAuthor: boolean;
  readonly onClose: () => void;
  readonly onPublished: (receipt: PublicationReceipt) => void;
}) => {
  const { client } = useApi();
  const id = useId();
  const [summary, setSummary] = useState("");
  const [verdict, setVerdict] = useState<PublicationVerdict>("comment");
  const [preview, setPreview] = useState<Publication | null>(null);
  const [previewError, setPreviewError] = useState<ApiError | null>(null);
  const [confirmStale, setConfirmStale] = useState(false);
  const [allowStale, setAllowStale] = useState(false);
  const publish = useMutation(client.publish);

  // The comments, and what the summary gets after the reviewer's text, don't depend on it.
  useEffect(() => {
    let current = true;
    void client.previewPublication(analysisId, { summary: "", hunkComments }).then((result) => {
      if (!current) return;
      setPreview(result.ok ? result.value : null);
      setPreviewError(result.ok ? null : result.error);
    });
    return () => {
      current = false;
    };
  }, [analysisId, client, hunkComments]);

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

  const label = publishLabel(preview?.comments.length ?? hunkComments.length);
  return (
    <Dialog title={label} onClose={onClose} className="sm:max-w-2xl">
      {previewError !== null ? (
        <p className={DANGER} role="alert">
          Couldn't read what will be posted. {errorMessage(previewError)}
        </p>
      ) : preview === null ? (
        <p className="text-muted-foreground">Reading the comments…</p>
      ) : (
        preview.comments.length > 0 && (
          <ul aria-label="Comments" className="flex flex-col gap-1.5">
            {preview.comments.map((comment) => (
              <li key={comment.key} className="border-l-2 border-l-review-pending py-0.5 pl-2.5">
                <code className="font-mono text-code-compact text-muted-foreground">
                  {comment.path}:
                  {comment.startLine === undefined
                    ? comment.line
                    : `${comment.startLine}–${comment.line}`}
                  {comment.side === "old" ? " (old side)" : ""}
                </code>
                <p className={POSTED}>{comment.body}</p>
              </li>
            ))}
          </ul>
        )
      )}

      {!isAuthor && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption text-muted-foreground">Verdict</span>
          <Segmented legend="Verdict" options={VERDICTS} value={verdict} onChange={setVerdict} />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-summary`} className="sr-only">
          Summary
        </label>
        <Textarea
          id={`${id}-summary`}
          rows={2}
          data-autofocus
          placeholder="Summary (optional)"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
      </div>

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
              {publish.pending ? "Publishing…" : publish.error !== null ? "Retry" : label}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
};
