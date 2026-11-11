import { bitbucketBugfix } from "./bitbucket-bugfix.ts";
import type { PullRequestFixture } from "./fixture.ts";
import { promptInjection } from "./prompt-injection.ts";
import { refactorMove } from "./refactor-move.ts";
import { smallFeature } from "./small-feature.ts";

export { fileChange, hunk } from "./builders.ts";
export { fixtureReviewers, type PullRequestFixture } from "./fixture.ts";
export {
  smallFeatureAnalysis,
  smallFeatureFiles,
  smallFeatureInput,
  smallFeatureIntent,
  smallFeaturePublication,
  smallFeatureSkeleton,
} from "./small-feature-analysis.ts";
export { smallFeatureThreadList, smallFeatureThreads } from "./small-feature-threads.ts";
export { bitbucketBugfix, promptInjection, refactorMove, smallFeature };

export const allFixtures: readonly PullRequestFixture[] = [
  smallFeature,
  refactorMove,
  bitbucketBugfix,
  promptInjection,
];
