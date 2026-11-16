import { LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type PullRequestRef, pullRequestUrl } from "../../../../src/domain/review/index.ts";
import { type ApiError, useApi } from "../../api/index.ts";
import { Link } from "../../app/Link.tsx";
import { redirect, reviewPath } from "../../app/router.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { HOST_NAMES, prLabel, SPIN } from "./PullRequestList.tsx";
import { LINK_BUTTON } from "./PullRequestLists.tsx";
import { StartFailure } from "./StartFailure.tsx";

/**
 * A PR opened by its address, as a row or the link field opened in a new tab: starts its analysis
 * and goes on to the review in place of this page, so Back skips it.
 */
export const OpenPullRequestPage = ({ pullRequest }: { readonly pullRequest: PullRequestRef }) => {
  const { client } = useApi();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const label = prLabel(pullRequest);

  // Only the latest start may move on: Cancel and leaving the page make the one running stale.
  const latest = useRef(0);
  useEffect(() => {
    latest.current = attempt;
    void client.startAnalysis({ url: pullRequestUrl(pullRequest) }).then((result) => {
      if (latest.current !== attempt) return;
      if (result.ok) redirect(reviewPath(result.value.analysisId));
      else setError(result.error);
    });
    return () => {
      latest.current = -1;
    };
  }, [client, pullRequest, attempt]);
  const cancel = () => {
    latest.current = -1;
    redirect("/");
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3 py-12">
      <h1 className="text-title font-semibold tracking-[-0.01em]">{label}</h1>
      <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body">
        {error === null ? (
          <>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <LoaderCircleIcon aria-hidden="true" className={cn("size-4", SPIN)} />
              Fetching {label} from {HOST_NAMES[pullRequest.repo.host]}…
            </span>
            <Button variant="link" className={LINK_BUTTON} onClick={cancel}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <span className="text-destructive">
              <TriangleAlertIcon aria-hidden="true" className="mr-1 inline size-4 align-[-3px]" />
              <StartFailure pullRequest={pullRequest} error={error} />
            </span>
            <Button
              variant="link"
              className={LINK_BUTTON}
              onClick={() => {
                setError(null);
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
          </>
        )}
      </p>
      {error !== null && (
        <p className="text-body">
          <Link to="/">Go to your pull requests</Link>
        </p>
      )}
    </div>
  );
};
