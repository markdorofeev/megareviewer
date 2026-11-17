import type { HostKind } from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { GitHost } from "../ports/index.ts";
import type { AppDeps } from "./deps.ts";
import { appError, type UseCaseError } from "./errors.ts";

export const hostName = (host: HostKind): string =>
  ({ github: "GitHub", bitbucket: "Bitbucket Cloud" })[host];

export const hostFor = (
  deps: Pick<AppDeps, "hosts">,
  host: HostKind,
): Result<GitHost, UseCaseError> => {
  const gitHost = deps.hosts[host];
  return gitHost === undefined
    ? err(appError("host-not-configured", `${hostName(host)} isn't configured`))
    : ok(gitHost);
};
