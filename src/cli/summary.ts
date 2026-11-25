import type { CheckoutInfo, Walk } from "../adapters/git/index.ts";
import type { ModelOptions } from "../domain/review/index.ts";
import { clonesSummary, repoName } from "./clones.ts";
import type { Config } from "./config.ts";
import { modelSummary } from "./model-access.ts";

/** What megareviewer prints once it's up. */
export const startSummary = (input: {
  readonly version: string;
  readonly config: Config;
  readonly model: ModelOptions;
  readonly checkout: CheckoutInfo | null;
  readonly walk: Walk | null;
  readonly url: string;
  readonly ui: boolean;
}): string => {
  const { config, checkout, walk } = input;
  const github = config.github === null ? "not configured" : `token from ${config.github.source}`;
  const bitbucket =
    config.bitbucket === null
      ? "not configured"
      : `as ${config.bitbucket.username} (${config.bitbucket.credential})${config.bitbucket.workspace === null ? "" : `, workspace ${config.bitbucket.workspace}`}`;
  const jira =
    config.jira === null ? "not configured: ticket keys aren't fetched" : config.jira.baseUrl;
  const repos = checkout?.repos.map(repoName).join(", ") ?? "";
  const none =
    walk === null
      ? "none: start in a checkout of the PR's repository, or pass --checkout, to show callers outside the PR"
      : "none here, so a PR's repository is looked for on this machine";
  const local = checkout === null ? none : `${checkout.root}${repos === "" ? "" : ` (${repos})`}`;
  return `megareviewer ${input.version}
  GitHub     ${github}
  Bitbucket  ${bitbucket}
  Jira       ${jira}
  Model      ${modelSummary(input.model)}
  Checkout   ${local}
  Clones     ${clonesSummary(walk)}
${input.ui ? "" : "\nNo built UI found, so only the API is served.\n"}
Open ${input.url}
Press Ctrl+C to stop.`;
};
