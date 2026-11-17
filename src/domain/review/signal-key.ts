import type { AnalysisId } from "./analysis.ts";
import type { PointId } from "./point.ts";
import { SignalKey } from "./preference.ts";
import type { Timestamp } from "./primitives.ts";
import type { CommentKey, HunkComment } from "./publication.ts";

export const pointSignalKey = (analysisId: AnalysisId, pointId: PointId): SignalKey =>
  SignalKey.parse(`point:${analysisId}:${pointId}`);

/** A line comment a review posted: the analysis, the review's number and the comment's key. */
export const publishedSignalKey = (
  analysisId: AnalysisId,
  publication: number,
  comment: CommentKey,
): SignalKey => SignalKey.parse(`review:${analysisId}:${publication}:${comment}`);

/** A comment posted now: nothing numbers it, so the time it was posted at tells two apart. */
export const postedSignalKey = (
  analysisId: AnalysisId,
  at: Timestamp,
  { hunkId, side, line }: Pick<HunkComment, "hunkId" | "side" | "line">,
): SignalKey => SignalKey.parse(`now:${analysisId}:${at}:${hunkId}:${side}:${line}`);
