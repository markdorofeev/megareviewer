import type { CheckoutInfo, Walk } from "../adapters/git/index.ts";
import type { ModelOptions } from "../domain/review/index.ts";
import { clonesSummary, downloadsSummary, repoName } from "./clones.ts";
import type { Config } from "./config.ts";
import { modelSummary } from "./model-access.ts";

/** What megareviewer prints once it's up. */
export const startSummary = (input: {
  readonly version: string;
  readonly config: Config;
  readonly model: ModelOptions;
  readonly checkout: CheckoutInfo | null;
  readonly walk: Walk | null;
  /** Where repositories are downloaded; null when that's off. */
  readonly downloadFolder: string | null;
  readonly url: string;
  readonly ui: boolean;
}): string => {
  const { config, checkout, walk, downloadFolder } = input;
  const github = config.github === null ? "not configured" : `token from ${config.github.source}`;
  const bitbucket =
    config.bitbucket === null
      ? "not configured"
      : `as ${config.bitbucket.username} (${config.bitbucket.credential})${config.bitbucket.workspace === null ? "" : `, workspace ${config.bitbucket.workspace}`}`;
  const jira =
    config.jira === null ? "not configured: ticket keys aren't fetched" : config.jira.baseUrl;
  const repos = checkout?.repos.map(repoName).join(", ") ?? "";
  const none =
    walk !== null
      ? "none here, so a PR's repository is looked for on this machine"
      : downloadFolder !== null
        ? "none here, so a PR's repository is downloaded"
        : "none: start in a checkout of the PR's repository, or pass --checkout, to show callers outside the PR";
  const local = checkout === null ? none : `${checkout.root}${repos === "" ? "" : ` (${repos})`}`;
  return `megareviewer ${input.version}
  GitHub     ${github}
  Bitbucket  ${bitbucket}
  Jira       ${jira}
  Model      ${modelSummary(input.model)}
  Checkout   ${local}
  Clones     ${clonesSummary(walk)}
  Download   ${downloadsSummary(downloadFolder)}
${input.ui ? "" : "\nNo built UI found, so only the API is served.\n"}
Open ${input.url}
Press Ctrl+C to stop.`;
};
