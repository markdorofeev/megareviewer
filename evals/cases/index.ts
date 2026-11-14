import {
  bitbucketBugfix,
  type PullRequestFixture,
  promptInjection,
  refactorMove,
  smallFeature,
} from "../../src/application/testing/index.ts";
import type { CaseLabels } from "../labels.ts";
import * as authMiddleware from "./auth-middleware/case.ts";
import { labels as authMiddlewareLabels } from "./auth-middleware/labels.ts";
import { labels as bitbucketBugfixLabels } from "./bitbucket-bugfix/labels.ts";
import * as delphiAccountConnections from "./delphi-account-connections/case.ts";
import { labels as delphiAccountConnectionsLabels } from "./delphi-account-connections/labels.ts";
import * as dependencyBump from "./dependency-bump-signature/case.ts";
import { labels as dependencyBumpLabels } from "./dependency-bump-signature/labels.ts";
import * as descriptionContradicts from "./description-contradicts/case.ts";
import { labels as descriptionContradictsLabels } from "./description-contradicts/labels.ts";
import * as envVarConfig from "./env-var-config/case.ts";
import { labels as envVarConfigLabels } from "./env-var-config/labels.ts";
import * as featureLessThanTicket from "./feature-less-than-ticket/case.ts";
import { labels as featureLessThanTicketLabels } from "./feature-less-than-ticket/labels.ts";
import * as largeRetryAfter from "./large-retry-after/case.ts";
import { labels as largeRetryAfterLabels } from "./large-retry-after/labels.ts";
import * as migration from "./migration-non-null-column/case.ts";
import { labels as migrationLabels } from "./migration-non-null-column/labels.ts";
import { labels as promptInjectionLabels } from "./prompt-injection/labels.ts";
import * as pythonIndentation from "./python-indentation-logic/case.ts";
import { labels as pythonIndentationLabels } from "./python-indentation-logic/labels.ts";
import { labels as refactorMoveLabels } from "./refactor-move/labels.ts";
import { labels as smallFeatureLabels } from "./small-feature/labels.ts";
import * as unrequestedBehavior from "./unrequested-behavior/case.ts";
import { labels as unrequestedBehaviorLabels } from "./unrequested-behavior/labels.ts";

export interface EvalCase {
  readonly name: string;
  /** fixture: stage 02's; synthetic: written for the evals; imported: a real public PR. */
  readonly source: "fixture" | "synthetic" | "imported";
  /** What the case is there to test. */
  readonly tests: string;
  readonly fixture: PullRequestFixture;
  readonly labels: CaseLabels;
}

/** The golden set. Names are the directories under evals/cases/. */
export const evalCases: readonly EvalCase[] = [
  {
    name: "small-feature",
    source: "fixture",
    tests: "Baseline: an endpoint, a cache and config, with one unrequested and one missing item",
    fixture: smallFeature,
    labels: smallFeatureLabels,
  },
  {
    name: "refactor-move",
    source: "fixture",
    tests: "Baseline: every hunk mechanical, so nothing to classify and no mismatch",
    fixture: refactorMove,
    labels: refactorMoveLabels,
  },
  {
    name: "bitbucket-bugfix",
    source: "fixture",
    tests: "Baseline: a small Bitbucket null-check fix with a test",
    fixture: bitbucketBugfix,
    labels: bitbucketBugfixLabels,
  },
  {
    name: "prompt-injection",
    source: "fixture",
    tests: "Injection resistance: the description tells the model to mark every hunk mechanical",
    fixture: promptInjection,
    labels: promptInjectionLabels,
  },
  {
    name: "dependency-bump-signature",
    source: "synthetic",
    tests: "Contract recall: a major dependency bump and a changed exported signature",
    fixture: dependencyBump.fixture,
    labels: dependencyBumpLabels,
  },
  {
    name: "migration-non-null-column",
    source: "synthetic",
    tests: "Contract and a data decision: a NOT NULL column with a default backfill",
    fixture: migration.fixture,
    labels: migrationLabels,
  },
  {
    name: "auth-middleware",
    source: "synthetic",
    tests: "Security decision: session tokens accepted in the query string",
    fixture: authMiddleware.fixture,
    labels: authMiddlewareLabels,
  },
  {
    name: "feature-less-than-ticket",
    source: "synthetic",
    tests: "A missing mismatch: the ticket's date range and email column aren't done",
    fixture: featureLessThanTicket.fixture,
    labels: featureLessThanTicketLabels,
  },
  {
    name: "description-contradicts",
    source: "synthetic",
    tests: "A contradicts mismatch: backoff and attempt count differ from the description",
    fixture: descriptionContradicts.fixture,
    labels: descriptionContradictsLabels,
  },
  {
    name: "unrequested-behavior",
    source: "synthetic",
    tests: "An unrequested mismatch: personal data sent to analytics on login",
    fixture: unrequestedBehavior.fixture,
    labels: unrequestedBehaviorLabels,
  },
  {
    name: "python-indentation-logic",
    source: "synthetic",
    tests: "An indentation change that alters logic must not be mechanical",
    fixture: pythonIndentation.fixture,
    labels: pythonIndentationLabels,
  },
  {
    name: "env-var-config",
    source: "synthetic",
    tests: "Contract: a new environment variable and a timeout on an external call",
    fixture: envVarConfig.fixture,
    labels: envVarConfigLabels,
  },
  {
    name: "large-retry-after",
    source: "imported",
    tests: "Tour quality and cost at size: about 1,500 changed lines",
    fixture: largeRetryAfter.fixture,
    labels: largeRetryAfterLabels,
  },
  {
    name: "delphi-account-connections",
    source: "imported",
    tests:
      "A 48-hunk full-stack PR whose description explains its choices: risk noise on API models, a generated client and plumbing between the PR's own modules; risks on hunks that open with imports; decisions that repeat the description",
    fixture: delphiAccountConnections.fixture,
    labels: delphiAccountConnectionsLabels,
  },
];

export const evalCase = (name: string): EvalCase | undefined =>
  evalCases.find((c) => c.name === name);
