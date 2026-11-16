import type { PullRequestRef } from "../../../../src/domain/review/index.ts";
import { type ApiError, errorMessage } from "../../api/index.ts";
import { useConnections } from "../../app/connections-context.tsx";
import { Button } from "../../ui/button.tsx";
import { HOST_NAMES, prLabel } from "./PullRequestList.tsx";
import { LINK_BUTTON } from "./PullRequestLists.tsx";

/** Why a PR didn't open, with a way to Connections when its host isn't configured. */
export const StartFailure = ({
  pullRequest,
  error,
}: {
  readonly pullRequest: PullRequestRef;
  readonly error: ApiError;
}) => {
  const { setOpen } = useConnections();
  const prefix = `Couldn't open ${prLabel(pullRequest)}: `;
  if (error.code !== "host-not-configured") return <>{`${prefix}${errorMessage(error)}`}</>;
  return (
    <>
      {prefix}
      {HOST_NAMES[pullRequest.repo.host]} isn't configured.{" "}
      <Button variant="link" className={LINK_BUTTON} onClick={() => setOpen(true)}>
        Open Connections
      </Button>
    </>
  );
};
