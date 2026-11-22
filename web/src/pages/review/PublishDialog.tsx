import { useEffect, useId, useState } from "react";
import {
  type AnalysisId,
  type HunkComment,
  isEmptyPublication,
  type Publication,
  PublicationId,
  type PublicationReceipt,
  type PublicationVerdict,
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
const POSTED = "whitespace-pre-wrap wrap-anywhere";

/**
 * What the button posts, the verdict last: "Publish 2 comments", "Publish and approve", "Publish 2
 * comments and request changes", or "Publish the summary" when that's all a comment says. It never
 * reads "Approve" alone, which would be the name of the verdict's own button too.
 */
export const publishLabel = (verdict: PublicationVerdict, count: number): string => {
  const what = count === 0 ? "" : ` ${count} ${count === 1 ? "comment" : "comments"}`;
  if (verdict === "comment") return what === "" ? "Publish the summary" : `Publish${what}`;
  return `Publish${what} and ${verdict === "approve" ? "approve" : "request changes"}`;
};

/**
 * The comments as they will be posted, the verdict the reviewer picks, an optional summary, and a
 * button that says what it posts. Nothing is posted that isn't shown here: the summary goes as
 * written. An author can only comment, as hosts don't let them approve their own PR, and the
 * dialog says so where the choice is. Each time it opens it's a review of its own, so once one is
 * published the next is another, with its own verdict.
 */
export const PublishDialog = ({
  analysisId,
  hunkComments,
  isAuthor,
  published,
  onClose,
  onPublished,
}: {
  readonly analysisId: AnalysisId;
  readonly hunkComments: readonly HunkComment[];
  /** The reviewer wrote the PR, so the review can only comment. */
  readonly isAuthor: boolean;
  /** A review was published from this analysis already, so this one is another. */
  readonly published: boolean;
  readonly onClose: () => void;
  /** With the verdict it posted, which is a comment on the reviewer's own PR. */
  readonly onPublished: (receipt: PublicationReceipt, verdict: PublicationVerdict) => void;
}) => {
  const { client } = useApi();
  const id = useId();
  const [summary, setSummary] = useState("");
  const [verdict, setVerdict] = useState<PublicationVerdict>("comment");
  const [preview, setPreview] = useState<Publication | null>(null);
  const [previewError, setPreviewError] = useState<ApiError | null>(null);
  const [confirmStale, setConfirmStale] = useState(false);
  const [allowStale, setAllowStale] = useState(false);
  // The same on every retry, so a review whose answer was lost isn't posted twice.
  const [publicationId] = useState(() => PublicationId.parse(crypto.randomUUID()));
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

  const chosen = isAuthor ? "comment" : verdict;
  const label = publishLabel(chosen, preview?.comments.length ?? hunkComments.length);
  // A comment with nothing in it: GitHub refuses it, and Bitbucket would post nothing.
  const nothing = preview !== null && isEmptyPublication({ ...preview, verdict: chosen, summary });

  const send = async (stale: boolean) => {
    setAllowStale(stale);
    setConfirmStale(false);
    const result = await publish.run(analysisId, {
      publicationId,
      summary,
      allowStale: stale,
      hunkComments,
      verdict: chosen,
    });
    if (result.ok) {
      onPublished(result.value, chosen);
    } else if (result.error.code === "stale-analysis") {
      publish.reset();
      setConfirmStale(true);
    }
  };

  return (
    // A column whose comments scroll on their own, so however many and long they are, the verdict,
    // the summary and Publish stay in view; on a window too short even for those, it all scrolls.
    <Dialog title="Publish review" onClose={onClose} className="flex flex-col sm:max-w-2xl">
      {published && (
        <p className="shrink-0 text-muted-foreground">
          Your earlier review is on the pull request. This one posts as another, with its own
          verdict.
        </p>
      )}
      {previewError !== null ? (
        <p className={DANGER} role="alert">
          Couldn't read what will be posted. {errorMessage(previewError)}
        </p>
      ) : preview === null ? (
        <p className="text-muted-foreground">Reading the comments…</p>
      ) : (
        preview.comments.length > 0 && (
          <section
            data-slot="publish-comments"
            aria-label="Comments to post"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: it scrolls, so the keyboard needs to reach it.
            tabIndex={0}
            className="-mx-4 min-h-12 overflow-y-auto overscroll-contain border-y px-4 py-3 -outline-offset-2"
          >
            <ul aria-label="Comments" className="flex flex-col gap-1.5">
              {preview.comments.map((comment) => (
                <li
                  key={comment.key}
                  className="min-w-0 border-l-2 border-l-review-pending py-0.5 pl-2.5"
                >
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
          </section>
        )
      )}

      <div className="flex shrink-0 flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption text-muted-foreground">Verdict</span>
            <Segmented
              legend="Verdict"
              options={VERDICTS.map((option) => ({
                ...option,
                disabled: isAuthor && option.value !== "comment",
              }))}
              value={chosen}
              onChange={setVerdict}
            />
          </div>
          {isAuthor && (
            <p className="text-caption text-muted-foreground">
              You opened this pull request, and its author can't approve it or request changes, so
              your review comments.
            </p>
          )}
        </div>

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
            <div className="flex flex-wrap items-center justify-end gap-2">
              {nothing && (
                <p id={`${id}-nothing`} className="mr-auto text-caption text-muted-foreground">
                  Nothing to post yet: write a summary, or approve or request changes.
                </p>
              )}
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={publish.pending || preview === null || nothing}
                aria-describedby={nothing ? `${id}-nothing` : undefined}
                onClick={() => void send(allowStale)}
              >
                {publish.pending ? "Publishing…" : publish.error !== null ? "Retry" : label}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
};
