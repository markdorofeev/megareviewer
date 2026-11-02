import { type Analysis, StageName, type StageStatus } from "../../../../src/domain/review/index.ts";

const STAGE_NAMES: Readonly<Record<StageName, string>> = {
  collect: "Collect",
  prep: "Prepare",
  intent: "Intent",
  risk: "Risk",
  decisions: "Decisions",
  tour: "Tour",
};

const STATUS_NAMES: Readonly<Record<StageStatus, string>> = {
  pending: "waiting",
  running: "running",
  done: "done",
  failed: "failed",
};

const MARKS: Readonly<Record<StageStatus, string>> = {
  pending: "○",
  running: "◐",
  done: "●",
  failed: "✗",
};

/**
 * The pipeline's stages and where each one is. While Collect runs, it also says how many of
 * the PR's files are in hand, so a slow host shows as progress rather than a stall.
 */
export const ProgressStrip = ({
  stages,
  filesFetched,
}: {
  readonly stages: Analysis["stages"];
  readonly filesFetched: Analysis["filesFetched"];
}) => (
  <ol className="progress-strip" aria-label="Analysis progress">
    {StageName.options.map((stage) => {
      const status = stages[stage];
      return (
        <li key={stage} className={`stage ${status}`}>
          <span aria-hidden="true">{MARKS[status]}</span> {STAGE_NAMES[stage]}
          <span className="visually-hidden">: {STATUS_NAMES[status]}</span>
          {stage === "collect" && status === "running" && filesFetched !== null && (
            <span className="stage-detail">
              {" "}
              · {filesFetched.done} of {filesFetched.total} files
            </span>
          )}
        </li>
      );
    })}
  </ol>
);

export const stageName = (stage: StageName): string => STAGE_NAMES[stage];
