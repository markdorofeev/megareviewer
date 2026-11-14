import { useState } from "react";
import type { AnalysisId } from "../../../../src/domain/review/index.ts";
import { errorMessage, useApi, useMutation } from "../../api/index.ts";
import { DANGER } from "../../review/shell/banners.ts";
import { Button } from "../../ui/button.tsx";
import { Dialog } from "./Dialog.tsx";

/** Takes Claude's run off the analysis, after asking, so the passes can be tried again. */
export const RemoveModelRun = ({
  analysisId,
  family,
  onRemoved,
}: {
  readonly analysisId: AnalysisId;
  /** Who made the run's points: "Claude". */
  readonly family: string;
  readonly onRemoved: () => void;
}) => {
  const { client } = useApi();
  const remove = useMutation(client.removeModelRun);
  const [asking, setAsking] = useState(false);

  return (
    <>
      <Button variant="ghost" size="xs" onClick={() => setAsking(true)}>
        Remove AI review…
      </Button>
      {asking && (
        <Dialog
          title="Remove AI review"
          onClose={() => {
            setAsking(false);
            remove.reset();
          }}
        >
          <p className="text-ui">
            {family}'s intent, findings, risks, decisions and tour titles go, with what you did with
            them, and the code's analysis runs again. Your comments stay. Request AI review runs a
            model again, the same or another.
          </p>
          {remove.error !== null && (
            <p className={DANGER} role="alert">
              Couldn't remove it. {errorMessage(remove.error)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" data-autofocus onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.pending}
              onClick={async () => {
                const removed = await remove.run(analysisId);
                if (!removed.ok) return;
                setAsking(false);
                onRemoved();
              }}
            >
              {remove.pending ? "Removing…" : "Remove"}
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
};
