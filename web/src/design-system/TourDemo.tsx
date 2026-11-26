import { type ReactNode, useMemo } from "react";
import { partHunk } from "../../../src/domain/diff/index.ts";
import { pointsOf } from "../../../src/domain/review/index.ts";
import { tourAnalysisView } from "../../dev/fixtures/index.ts";
import { fileOverview } from "../pages/review/overview.ts";
import { type TourExcerpt, tourOf } from "../pages/review/tour.ts";
import { TourLanding, Understand } from "../pages/review/Understand.tsx";
import { HunkCard, type PointLine } from "../review/index.ts";

const analysis = tourAnalysisView.analysis;

/** The Understand layout on the fixture PR's tour, and the pieces it shows elsewhere. */
export const TourDemo = () => {
  const tour = useMemo(() => tourOf(analysis, fileOverview(analysis), pointsOf(analysis)), []);
  const found = (excerpt: TourExcerpt) =>
    analysis.files
      .flatMap((file) => file.hunks.map((hunk) => ({ hunk, file })))
      .find(({ hunk }) => hunk.id === excerpt.hunkId);
  const excerptCard = (excerpt: TourExcerpt): ReactNode => {
    const at = found(excerpt);
    return at === undefined ? null : (
      <HunkCard
        id={excerpt.partId}
        hunk={partHunk(at.hunk, excerpt)}
        file={at.file}
        risk={null}
        inFile
      />
    );
  };
  const [step] = tour?.steps ?? [];
  const [excerpt] = step?.excerpts ?? [];
  const landed = excerpt === undefined ? undefined : found(excerpt);
  const marks = new Map<string, PointLine>(
    landed === undefined || excerpt === undefined
      ? []
      : landed.hunk.lines
          .slice(excerpt.start, excerpt.end)
          .flatMap((line) =>
            line.newLine === null ? [] : [[`new:${line.newLine}`, { kind: "step" as const }]],
          ),
  );
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border px-3">
        {tour !== null && (
          <Understand
            tour={tour}
            stateOf={(point) => (point.id === "f2" ? "dismissed" : "open")}
            renderExcerpt={excerptCard}
            onOpenPoint={() => {}}
            onOpenFile={() => {}}
            onOpenInCode={() => {}}
          />
        )}
      </div>
      {step !== undefined && excerpt !== undefined && landed !== undefined && (
        <div className="overflow-hidden rounded-lg border">
          <TourLanding step={step} excerpt={excerpt} />
          <HunkCard hunk={landed.hunk} file={landed.file} risk={null} inFile pointLines={marks} />
        </div>
      )}
    </div>
  );
};
