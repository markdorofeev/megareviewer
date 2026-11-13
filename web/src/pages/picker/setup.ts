import type { HostStatus, StatusResponse } from "../../../../contracts/index.ts";

export interface SetupItem {
  readonly name: string;
  /** optional: not configured, and megareviewer works without it. */
  readonly state: "ok" | "missing" | "optional" | "error";
  readonly text: string;
}

/** An unconfigured host is fine while the other one works: megareviewer needs one. */
const host = (
  name: string,
  status: HostStatus,
  otherConfigured: boolean,
  fix: string,
): SetupItem => {
  if (!status.configured) {
    return {
      name,
      state: otherConfigured ? "optional" : "missing",
      text: `Not configured: ${fix}`,
    };
  }
  if (status.user !== null) return { name, state: "ok", text: status.user.name };
  return { name, state: "error", text: status.error ?? "Couldn't read the signed-in user" };
};

/** What's set up, and how to fix what isn't. */
export const setupItems = (status: StatusResponse): readonly SetupItem[] => {
  const { github, bitbucket } = status.hosts;
  return [
    host("GitHub", github, bitbucket.configured, "set GITHUB_TOKEN or run gh auth login"),
    host("Bitbucket", bitbucket, github.configured, "set BITBUCKET_EMAIL and BITBUCKET_API_TOKEN"),
    status.jira.configured
      ? { name: "Jira", state: "ok", text: "Configured" }
      : {
          name: "Jira",
          state: "optional",
          text: "Not configured: set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN to read linked tickets",
        },
    status.model.available
      ? {
          name: "Claude",
          state: "ok",
          text: `${status.model.via}: Request AI review, on a review, adds intent, decisions and the tour's titles`,
        }
      : {
          name: "Claude",
          state: "optional",
          text: `Unavailable: ${status.model.reason}`,
        },
  ];
};
