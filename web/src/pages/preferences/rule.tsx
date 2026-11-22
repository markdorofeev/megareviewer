import { BanIcon, GlobeIcon, type LucideIcon, SearchIcon } from "lucide-react";
import type {
  PreferenceKind,
  PreferenceScope,
  RepoRef,
} from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { HOST_NAMES } from "../picker/PullRequestList.tsx";
import { HostIcon } from "./HostIcon.tsx";

/** A kind's word and glyph, which say it without a color. */
export const KIND: Readonly<
  Record<PreferenceKind, { readonly label: string; readonly icon: LucideIcon }>
> = {
  "look-for": { label: "Look for", icon: SearchIcon },
  "dont-flag": { label: "Don't flag", icon: BanIcon },
};

export const KindChip = ({
  kind,
  className,
}: {
  readonly kind: PreferenceKind;
  readonly className?: string;
}) => {
  const { label, icon: Icon } = KIND[kind];
  return (
    <span
      data-slot="preference-kind"
      data-kind={kind}
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-[5px] rounded-md border bg-secondary pr-2 pl-[7px] text-caption font-medium whitespace-nowrap text-secondary-foreground",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3 text-muted-foreground" />
      {label}
    </span>
  );
};

export const GLOBAL: PreferenceScope = { kind: "global" };

export const repoName = ({ owner, repo }: RepoRef): string => `${owner}/${repo}`;

export const repoKey = ({ host, owner, repo }: RepoRef): string => `${host}/${owner}/${repo}`;

export const scopeKey = (scope: PreferenceScope): string =>
  scope.kind === "global" ? "global" : repoKey(scope.repo);

/** A scope the form offers, by the name the reviewer reads. */
export interface ScopeOption {
  readonly key: string;
  readonly label: string;
  readonly scope: PreferenceScope;
}

/** Everywhere, then each repository; two of one name on different hosts say which host. */
export const scopeOptions = (repos: readonly RepoRef[]): ScopeOption[] => [
  { key: scopeKey(GLOBAL), label: "Everywhere", scope: GLOBAL },
  ...repos.map((repo): ScopeOption => {
    const clash = repos.some((other) => other !== repo && repoName(other) === repoName(repo));
    return {
      key: repoKey(repo),
      label: clash ? `${repoName(repo)} on ${HOST_NAMES[repo.host]}` : repoName(repo),
      scope: { kind: "repo", repo },
    };
  }),
];

/** A scope's glyph: a globe for everywhere, else its repository's host. */
export const ScopeIcon = ({
  scope,
  className,
}: {
  readonly scope: PreferenceScope;
  readonly className?: string;
}) =>
  scope.kind === "global" ? (
    <GlobeIcon aria-hidden="true" className={cn("size-[15px] shrink-0", className)} />
  ) : (
    <HostIcon host={scope.repo.host} className={className} />
  );
