import type { StatusResponse } from "../../../contracts/index.ts";

export const fixtureStatus: StatusResponse = {
  version: "0.0.0-mock",
  hosts: {
    github: { configured: true, user: { id: "lee-park", name: "Lee Park" }, error: null },
    bitbucket: { configured: false, user: null, error: null },
  },
  jira: { configured: true },
  model: { enabled: true },
};
