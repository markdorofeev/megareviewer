import {
  bitbucketBugfix,
  type PullRequestFixture,
  promptInjection,
  refactorMove,
  smallFeature,
} from "../../src/application/testing/index.ts";
import type { CaseGuidance } from "../guidance.ts";
import type { CaseLabels } from "../labels.ts";
import * as authMiddleware from "./auth-middleware/case.ts";
import { labels as authMiddlewareLabels } from "./auth-middleware/labels.ts";
import { labels as bitbucketBugfixLabels } from "./bitbucket-bugfix/labels.ts";
import * as callerKeepsOldUnit from "./caller-keeps-old-unit/case.ts";
import { labels as callerKeepsOldUnitLabels } from "./caller-keeps-old-unit/labels.ts";
import * as credentialMoved from "./credential-moved/case.ts";
import { labels as credentialMovedLabels } from "./credential-moved/labels.ts";
import * as delphiAccountConnections from "./delphi-account-connections/case.ts";
import { labels as delphiAccountConnectionsLabels } from "./delphi-account-connections/labels.ts";
import * as dependencyBump from "./dependency-bump-signature/case.ts";
import { labels as dependencyBumpLabels } from "./dependency-bump-signature/labels.ts";
import * as descriptionContradicts from "./description-contradicts/case.ts";
import { labels as descriptionContradictsLabels } from "./description-contradicts/labels.ts";
import * as discountsWrittenTwice from "./discounts-written-twice/case.ts";
import { labels as discountsWrittenTwiceLabels } from "./discounts-written-twice/labels.ts";
import * as envVarConfig from "./env-var-config/case.ts";
import { labels as envVarConfigLabels } from "./env-var-config/labels.ts";
import * as featureLessThanTicket from "./feature-less-than-ticket/case.ts";
import { labels as featureLessThanTicketLabels } from "./feature-less-than-ticket/labels.ts";
import * as guidelineFile from "./guideline-file/case.ts";
import { labels as guidelineFileLabels } from "./guideline-file/labels.ts";
import * as largeRetryAfter from "./large-retry-after/case.ts";
import { labels as largeRetryAfterLabels } from "./large-retry-after/labels.ts";
import * as migration from "./migration-non-null-column/case.ts";
import { labels as migrationLabels } from "./migration-non-null-column/labels.ts";
import * as optionalResponseField from "./optional-response-field/case.ts";
import { labels as optionalResponseFieldLabels } from "./optional-response-field/labels.ts";
import * as preferenceDontFlag from "./preference-dont-flag/case.ts";
import { labels as preferenceDontFlagLabels } from "./preference-dont-flag/labels.ts";
import * as preferenceLookFor from "./preference-look-for/case.ts";
import { labels as preferenceLookForLabels } from "./preference-look-for/labels.ts";
import { labels as promptInjectionLabels } from "./prompt-injection/labels.ts";
import * as pythonIndentation from "./python-indentation-logic/case.ts";
import { labels as pythonIndentationLabels } from "./python-indentation-logic/labels.ts";
import { labels as refactorMoveLabels } from "./refactor-move/labels.ts";
import * as routeSkipsService from "./route-skips-service/case.ts";
import { labels as routeSkipsServiceLabels } from "./route-skips-service/labels.ts";
import { labels as smallFeatureLabels } from "./small-feature/labels.ts";
import * as storedSessionsFormat from "./stored-sessions-format/case.ts";
import { labels as storedSessionsFormatLabels } from "./stored-sessions-format/labels.ts";
import * as testNamedCoverage from "./test-named-coverage/case.ts";
import { labels as testNamedCoverageLabels } from "./test-named-coverage/labels.ts";
import * as unrequestedBehavior from "./unrequested-behavior/case.ts";
import { labels as unrequestedBehaviorLabels } from "./unrequested-behavior/labels.ts";

export interface EvalCase {
  readonly name: string;
  /** fixture: stage 02's; synthetic: written for the evals; imported: a real public PR. */
  readonly source: "fixture" | "synthetic" | "imported";
  /** What the case is there to test. */
  readonly tests: string;
  readonly fixture: PullRequestFixture;
  /** What a run of it reads beside the PR; without it, nothing. */
  readonly guidance?: CaseGuidance;
  /** The repository's files the PR doesn't change; with them, a run has a checkout. */
  readonly outside?: Readonly<Record<string, string>>;
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
    tests: "Baseline: every hunk mechanical, so no finding and no mismatch",
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
    tests:
      "Nothing wrong: a major dependency bump and a changed exported signature, both asked for",
    fixture: dependencyBump.fixture,
    labels: dependencyBumpLabels,
  },
  {
    name: "migration-non-null-column",
    source: "synthetic",
    tests: "A NOT NULL column with a default backfill, with at most a minor finding",
    fixture: migration.fixture,
    labels: migrationLabels,
  },
  {
    name: "auth-middleware",
    source: "synthetic",
    tests: "A security finding: session tokens accepted in the query string",
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
    tests: "Nothing wrong: an indentation change that alters logic, as the ticket asks",
    fixture: pythonIndentation.fixture,
    labels: pythonIndentationLabels,
  },
  {
    name: "env-var-config",
    source: "synthetic",
    tests:
      "A new environment variable and a timeout on an external call, with at most a minor finding",
    fixture: envVarConfig.fixture,
    labels: envVarConfigLabels,
  },
  {
    name: "test-named-coverage",
    source: "synthetic",
    tests:
      "A contradicts mismatch found in the code: an export open to a role the ticket shuts out, under a test named for the check that never runs it",
    fixture: testNamedCoverage.fixture,
    labels: testNamedCoverageLabels,
  },
  {
    name: "preference-look-for",
    source: "synthetic",
    tests:
      "A Look for preference: a ticket query that loses its tenant filter when no status is given, found and marked with the preference",
    fixture: preferenceLookFor.fixture,
    guidance: preferenceLookFor.guidance,
    labels: preferenceLookForLabels,
  },
  {
    name: "preference-dont-flag",
    source: "synthetic",
    tests:
      "A Don't flag preference: a leftover console.log left out, and the paging bug beside it still raised, unmarked",
    fixture: preferenceDontFlag.fixture,
    guidance: preferenceDontFlag.guidance,
    labels: preferenceDontFlagLabels,
  },
  {
    name: "guideline-file",
    source: "synthetic",
    tests:
      "A guideline file: REVIEW.md asks for reversible migrations, and the PR's has no down section",
    fixture: guidelineFile.fixture,
    guidance: guidelineFile.guidance,
    labels: guidelineFileLabels,
  },
  {
    name: "caller-keeps-old-unit",
    source: "synthetic",
    tests:
      "A contract finding an unchanged caller shows: a total now in cents, and billing still multiplies it by 100",
    fixture: callerKeepsOldUnit.fixture,
    outside: callerKeepsOldUnit.outside,
    labels: callerKeepsOldUnitLabels,
  },
  {
    name: "stored-sessions-format",
    source: "synthetic",
    tests:
      "A contract finding stored data shows: sessions written before the change can't be read after it",
    fixture: storedSessionsFormat.fixture,
    labels: storedSessionsFormatLabels,
  },
  {
    name: "route-skips-service",
    source: "synthetic",
    tests:
      "An architecture finding: a route runs SQL past the service and the repository the rest goes through",
    fixture: routeSkipsService.fixture,
    labels: routeSkipsServiceLabels,
  },
  {
    name: "discounts-written-twice",
    source: "synthetic",
    tests: "An architecture finding: a quote's discounts written again beside the pricing module's",
    fixture: discountsWrittenTwice.fixture,
    labels: discountsWrittenTwiceLabels,
  },
  {
    name: "optional-response-field",
    source: "synthetic",
    tests:
      "Nothing wrong: an optional field in an API's response, and the code outside the PR that reads it still works",
    fixture: optionalResponseField.fixture,
    outside: optionalResponseField.outside,
    labels: optionalResponseFieldLabels,
  },
  {
    name: "credential-moved",
    source: "synthetic",
    tests: "Nothing wrong: a credential read in another module, the same way",
    fixture: credentialMoved.fixture,
    labels: credentialMovedLabels,
  },
  {
    name: "large-retry-after",
    source: "imported",
    tests: "Noise and cost at size: about 1,500 changed lines",
    fixture: largeRetryAfter.fixture,
    labels: largeRetryAfterLabels,
  },
  {
    name: "delphi-account-connections",
    source: "imported",
    tests:
      "A 48-hunk full-stack PR: three must-have findings in how it stores and orders credentials, and none on its API models, generated client and the plumbing between its own modules",
    fixture: delphiAccountConnections.fixture,
    labels: delphiAccountConnectionsLabels,
  },
];

export const evalCase = (name: string): EvalCase | undefined =>
  evalCases.find((c) => c.name === name);
