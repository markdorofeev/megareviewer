import { createAnalysisEvents } from "../src/application/events/index.ts";
import type {
  AnalysisInput,
  AnalysisModel,
  CodeParser,
  Logger,
} from "../src/application/ports/index.ts";
import {
  FakeGitHost,
  FakeLocalCheckouts,
  FakeModelCatalog,
  FakeTicketSource,
  fakeModelOption,
  InMemoryAnalysisStore,
  InMemoryFileCache,
  type PullRequestFixture,
} from "../src/application/testing/index.ts";
import { createUseCases } from "../src/application/use-cases/index.ts";
import { type Analysis, inProgress, modelRunnable } from "../src/domain/review/index.ts";
import { err, ok, type Result } from "../src/domain/shared/index.ts";

export const systemClock = { now: () => new Date().toISOString() };

export const quietLogger = (onProblem: (line: string) => void = () => {}): Logger => ({
  debug: () => {},
  info: () => {},
  warn: (message, fields) => onProblem(`warn: ${message} ${JSON.stringify(fields ?? {})}`),
  error: (message, fields) => onProblem(`error: ${message} ${JSON.stringify(fields ?? {})}`),
});

export interface AnalyzeOptions {
  readonly model: AnalysisModel;
  readonly parser: CodeParser;
  readonly logger: Logger;
  /** The whole analysis, from start to complete or failed. */
  readonly timeoutMs: number;
}

export interface CaseRun {
  readonly analysis: Analysis;
  /** What the model was given first, which the judge reads; null when the model never ran. */
  readonly input: AnalysisInput | null;
}

/** The model, keeping the input of its first call. Every call of a run gets the same PR. */
const recordingInput = (model: AnalysisModel) => {
  let input: AnalysisInput | null = null;
  const keep = (given: AnalysisInput) => {
    input ??= given;
  };
  const recording: AnalysisModel = {
    version: model.version,
    checkSize: (given) => (keep(given), model.checkSize(given)),
    intent: (given, options) => (keep(given), model.intent(given, options)),
    findings: (given, intent, options) => (keep(given), model.findings(given, intent, options)),
    risk: (given, intent, options) => (keep(given), model.risk(given, intent, options)),
    decisions: (given, intent, options) => (keep(given), model.decisions(given, intent, options)),
    tour: (given, intent, risk, decisions, skeleton, options) => (
      keep(given), model.tour(given, intent, risk, decisions, skeleton, options)
    ),
  };
  return { model: recording, input: () => input };
};

/**
 * Runs the analysis pipeline on one case, as the CLI would: the case's PR on a fake host, its
 * tickets in a fake Jira, the given model and parser, an in-memory store. Once the code's
 * analysis completes, runs the model on it, as "Request AI review" does. Resolves with the
 * analysis and the model's input once both end; an error only when it didn't start or ran out
 * of time.
 */
export const analyzeCase = async (
  fixture: PullRequestFixture,
  options: AnalyzeOptions,
): Promise<Result<CaseRun, string>> => {
  const { host } = fixture.pullRequest.ref.repo;
  const recorded = recordingInput(options.model);
  const store = new InMemoryAnalysisStore();
  const events = createAnalysisEvents();
  const useCases = createUseCases(
    {
      hosts: { [host]: new FakeGitHost({ host, fixtures: [fixture], clock: systemClock }) },
      tickets: new FakeTicketSource({ tickets: fixture.tickets }),
      models: new FakeModelCatalog({
        model: recorded.model,
        options: [fakeModelOption({ via: "the eval's model" })],
      }),
      store,
      fileCache: new InMemoryFileCache(),
      checkouts: new FakeLocalCheckouts(),
      threads: {},
      statuses: {},
      parser: options.parser,
      events,
      clock: systemClock,
      logger: options.logger,
    },
    { version: "eval" },
  );

  const started = await useCases.startAnalysis(fixture.pullRequest.url);
  if (!started.ok) return err(`${started.error.code}: ${started.error.message}`);
  const id = started.value.analysisId;

  let modelAsked = false;
  /** The analysis once nothing runs on it, after asking for the model once the code's is done. */
  const finished = async (): Promise<Analysis | null> => {
    const analysis = await store.getAnalysis(id);
    if (analysis === null || inProgress(analysis)) return null;
    if (modelAsked || !modelRunnable(analysis)) return analysis;
    modelAsked = true;
    const ran = await useCases.runModel(id);
    if (!ran.ok) throw new Error(`${ran.error.code}: ${ran.error.message}`);
    return null;
  };

  let unsubscribe = () => {};
  let timer: NodeJS.Timeout | undefined;
  try {
    return await new Promise<Result<CaseRun, string>>((resolve, reject) => {
      const check = () =>
        finished().then(
          (analysis) => analysis && resolve(ok({ analysis, input: recorded.input() })),
          reject,
        );
      // No buffering in the events, so check once after subscribing too.
      unsubscribe = events.subscribe(id, (event) => {
        if (event.type === "done") check();
      });
      check();
      timer = setTimeout(
        () => resolve(err(`timed out after ${options.timeoutMs / 1000} s`)),
        options.timeoutMs,
      );
    });
  } finally {
    unsubscribe();
    clearTimeout(timer);
  }
};
