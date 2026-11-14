import type { PullRequestFixture } from "../../../src/application/testing/index.ts";
import { fixtureFromImport } from "../../case-files.ts";

export const fixture: PullRequestFixture = fixtureFromImport(
  new URL(".", import.meta.url),
  "delphi-account-connections",
);
