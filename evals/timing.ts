import type { Analysis, ModelPass } from "../src/domain/review/index.ts";

export interface PassTime {
  readonly pass: ModelPass;
  /** Its calls added up, a retry's included. */
  readonly seconds: number;
  readonly calls: number;
}

/** Where a case's time went, from the model calls its analysis kept. */
export interface CaseTiming {
  /** The analysis, from its start until it completed or failed. */
  readonly analysisS: number;
  /** The code's stages: from the analysis's start to its first model call. Null without one. */
  readonly prepS: number | null;
  /** In the order the passes first started. */
  readonly passes: readonly PassTime[];
  /** Null when the judge didn't run. */
  readonly judgeS: number | null;
}

const seconds = (ms: number) => ms / 1000;

export const timingOf = (
  analysis: Pick<Analysis, "createdAt" | "modelCalls">,
  analysisS: number,
  judgeS: number | null,
): CaseTiming => {
  const calls = [...analysis.modelCalls].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const first = calls[0];
  const passes: PassTime[] = [];
  for (const call of calls) {
    const index = passes.findIndex((p) => p.pass === call.pass);
    const time = passes[index];
    if (time === undefined) {
      passes.push({ pass: call.pass, seconds: seconds(call.durationMs), calls: 1 });
    } else {
      passes[index] = {
        ...time,
        seconds: time.seconds + seconds(call.durationMs),
        calls: time.calls + 1,
      };
    }
  }
  return {
    analysisS,
    prepS:
      first === undefined
        ? null
        : seconds(Date.parse(first.startedAt) - Date.parse(analysis.createdAt)),
    passes,
    judgeS,
  };
};

const s = (value: number) => `${value < 10 ? value.toFixed(1) : value.toFixed(0)} s`;

/** "analysis 174 s (prep 0.4 s · intent 15 s · findings 147 s · …) · judge 18 s" */
export const showTiming = (timing: CaseTiming): string => {
  const parts = [
    ...(timing.prepS === null ? [] : [`prep ${s(timing.prepS)}`]),
    ...timing.passes.map(
      (p) => `${p.pass} ${s(p.seconds)}${p.calls > 1 ? ` in ${p.calls} calls` : ""}`,
    ),
  ];
  return (
    `analysis ${s(timing.analysisS)}` +
    (parts.length === 0 ? "" : ` (${parts.join(" · ")})`) +
    (timing.judgeS === null ? "" : ` · judge ${s(timing.judgeS)}`)
  );
};
