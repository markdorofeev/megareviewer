import { useEffect, useId, useRef, useState } from "react";
import type {
  AnalysisId,
  HunkComment,
  Publication,
  PublicationReceipt,
  PublicationVerdict,
} from "../../../../src/domain/review/index.ts";
import { type ApiError, errorMessage, useApi, useMutation } from "../../api/index.ts";
import { Dialog } from "./Dialog.tsx";

/** The preview refreshes once typing in the summary pauses for this long. */
export const PREVIEW_DELAY_MS = 400;

const VERDICT_NAMES: Readonly<Record<PublicationVerdict, string>> = {
  approve: "Approve",
  request_changes: "Request changes",
  comment: "Comment",
};

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
    <Dialog title="Publish the review" onClose={onClose} className="publish-dialog">
      <label htmlFor={`${id}-summary`}>Summary</label>
      <textarea
        id={`${id}-summary`}
        className="input summary-field"
        rows={4}
        data-autofocus
        placeholder="What you'd like the author to know overall (optional)"
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
      />

      {chooseVerdict && !isAuthor && (
        <fieldset className="verdict-choice">
          <legend>Verdict</legend>
          {(["approve", "request_changes", "comment"] as const).map((option) => (
            <label key={option}>
              <input
                type="radio"
                name={`${id}-verdict`}
                checked={chosen === option}
                onChange={() => setChosen(option)}
              />
              {VERDICT_NAMES[option]}
            </label>
          ))}
        </fieldset>
      )}

      <section className="preview" aria-labelledby={`${id}-preview`} aria-busy={preview === null}>
        <h3 id={`${id}-preview`}>What will be posted</h3>
        {previewError !== null ? (
          <p className="banner danger" role="alert">
            Couldn't build the preview. {errorMessage(previewError)}
          </p>
        ) : preview === null ? (
          <p className="muted">Building the preview…</p>
        ) : (
          <>
            <p>
              Verdict:{" "}
              <strong className={`publication-verdict ${preview.verdict}`}>
                {VERDICT_NAMES[preview.verdict]}
              </strong>
            </p>
            {isAuthor && preview.verdict === "comment" && (
              <p className="muted">
                You opened this pull request, so the review is posted as a comment: hosts don't let
                authors approve their own pull requests or request changes on them.
              </p>
            )}
            {pendingCount > 0 && (
              <p className="banner warning">
                {plural(pendingCount, "decision isn't", "decisions aren't")} reviewed yet. The
                summary lists {pendingCount === 1 ? "it" : "them"} as not reviewed.
              </p>
            )}
            <h4>{plural(preview.comments.length, "inline comment", "inline comments")}</h4>
            {preview.comments.length > 0 && (
              <ul className="preview-comments">
                {preview.comments.map((comment) => (
                  <li key={comment.key}>
                    <code>
                      {comment.path}:{comment.line}
                      {comment.side === "old" ? " (old side)" : ""}
                    </code>
                    <p className="posted-text">{comment.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <h4>Summary comment</h4>
            <p className="posted-text">{preview.summary}</p>
          </>
        )}
      </section>

      {confirmStale ? (
        <div className="banner warning" role="alert">
          <p>This PR changed since the analysis. Publish anyway?</p>
          <div className="dialog-actions">
            <button type="button" className="button" onClick={() => setConfirmStale(false)}>
              Cancel
            </button>
            <button type="button" className="button primary" onClick={() => void send(true)}>
              Publish anyway
            </button>
          </div>
        </div>
      ) : (
        <>
          {publish.error !== null && (
            <div className="banner danger" role="alert">
              <p>Couldn't publish. {errorMessage(publish.error)}</p>
              <p className="muted">
                Retrying is safe: comments that were already posted aren't posted again.
              </p>
            </div>
          )}
          <div className="dialog-actions">
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="button primary"
              disabled={publish.pending || preview === null}
              onClick={() => void send(allowStale)}
            >
              {publish.pending ? "Publishing…" : publish.error !== null ? "Retry" : "Publish"}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
};
