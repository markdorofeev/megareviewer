import type { HostError, HostUser, RepoRef } from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import { API, type BitbucketClient } from "./client.ts";
import { toHostUser } from "./map.ts";
import { BitbucketAccount, BitbucketPage, BitbucketRepositoryPermission } from "./schemas.ts";

export const USER_URL = `${API}/user`;

/** The caller's own permission on one repository of the workspace, which names the caller. */
export const permissionsUrl = (workspace: string): string =>
  `${API}/user/workspaces/${encodeURIComponent(workspace)}/permissions/repositories?${new URLSearchParams(
    { pagelen: "1", fields: "values.user.uuid,values.user.display_name" },
  )}`;

/** Failures that every other call would meet too, so asking elsewhere can't help. */
const FATAL: ReadonlySet<HostError["kind"]> = new Set(["unauthorized", "rate-limited", "network"]);

const reasonOf = ({ kind, message }: HostError): string =>
  kind === "not-found" ? "no such workspace" : message;

/** Who the credentials belong to, asked once. `repo` is one whose workspace may name them. */
export type UserLookup = (repo?: RepoRef) => Promise<Result<HostUser, HostError>>;

/**
 * `GET /user` needs the token to have `read:user:bitbucket`, for nothing else megareviewer does.
 * A workspace's repository permissions name the caller with `read:repository:bitbucket`, so it's
 * asked first, and `GET /user` only when no workspace answers.
 */
export const createUserLookup = (
  client: BitbucketClient,
  configuredWorkspace: string | null,
): UserLookup => {
  let cached: HostUser | null = null;

  return async (repo) => {
    if (cached !== null) return ok(cached);

    const workspaces = new Set(
      [configuredWorkspace, repo?.owner ?? null].filter((workspace) => workspace !== null),
    );
    const reasons: string[] = [];
    for (const workspace of workspaces) {
      const page = await client.json(
        "the current user",
        BitbucketPage(BitbucketRepositoryPermission),
        permissionsUrl(workspace),
      );
      if (!page.ok && FATAL.has(page.error.kind)) return page;
      const permission = page.ok ? page.value.values[0] : undefined;
      if (permission !== undefined) {
        cached = toHostUser(permission.user);
        return ok(cached);
      }
      reasons.push(
        `${workspace}: ${page.ok ? "no repository you were given access to" : reasonOf(page.error)}`,
      );
    }

    const user = await client.json("the current user", BitbucketAccount, USER_URL);
    if (user.ok) {
      cached = toHostUser(user.value);
      return ok(cached);
    }
    if (user.error.kind !== "forbidden") return user;
    const asked = reasons.length === 0 ? "" : ` (${reasons.join("; ")})`;
    return err({
      ...user.error,
      message: `Bitbucket didn't say who you are${asked}. Set BITBUCKET_WORKSPACE to a workspace with a repository you were given access to, or give the token read:user:bitbucket.`,
    });
  };
};
