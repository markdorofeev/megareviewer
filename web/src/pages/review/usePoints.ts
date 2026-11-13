import { useCallback, useRef, useState } from "react";
import type {
  AnalysisId,
  PointId,
  PointReview,
  PointState,
} from "../../../../src/domain/review/index.ts";
import { errorMessage, useApi } from "../../api/index.ts";

export interface StateFailure {
  readonly pointId: PointId;
  readonly message: string;
}

/**
 * Raised and dismissed points. A state shows at once and rolls back if the save fails: the
 * reviewer sees what they clicked, and never a state the server didn't take.
 */
export const usePoints = (analysisId: AnalysisId, saved: readonly PointReview[]) => {
  const { client } = useApi();
  const [changed, setChanged] = useState<ReadonlyMap<PointId, PointState>>(new Map());
  const [saving, setSaving] = useState<ReadonlySet<PointId>>(new Set());
  const [failure, setFailure] = useState<StateFailure | null>(null);
  const sequence = useRef(new Map<PointId, number>());

  const stateOf = (id: PointId): PointState =>
    changed.get(id) ?? saved.find((review) => review.pointId === id)?.state ?? "open";

  const setState = useCallback(
    async (id: PointId, state: PointState) => {
      setChanged((previous) => new Map(previous).set(id, state));
      setSaving((previous) => new Set(previous).add(id));
      const count = (sequence.current.get(id) ?? 0) + 1;
      sequence.current.set(id, count);
      const result = await client.putPointState(analysisId, id, { state });
      if (sequence.current.get(id) !== count) return;
      setSaving((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
      if (result.ok) {
        setFailure((previous) => (previous?.pointId === id ? null : previous));
        return;
      }
      // Back to what the server has, so the card never shows a state it didn't take.
      setChanged((previous) => {
        const next = new Map(previous);
        next.delete(id);
        return next;
      });
      setFailure({ pointId: id, message: errorMessage(result.error) });
    },
    [analysisId, client],
  );

  return {
    stateOf,
    setState,
    isSaving: (id: PointId): boolean => saving.has(id),
    failure,
    dismissFailure: () => setFailure(null),
  };
};
