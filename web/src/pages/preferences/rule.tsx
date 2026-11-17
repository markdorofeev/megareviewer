import { FlagOffIcon, type LucideIcon, SearchIcon } from "lucide-react";
import type {
  PreferenceKind,
  PreferenceScope,
  PreferenceSource,
  RepoRef,
} from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { HOST_NAMES } from "../picker/PullRequestList.tsx";

/** A kind's word and glyph, which go wherever its tint does. */
export const KIND: Readonly<
  Record<
    PreferenceKind,
    { readonly label: string; readonly icon: LucideIcon; readonly className: string }
  >
> = {
  "look-for": {
    label: "Look for",
    icon: SearchIcon,
    className: "border-diff-hunk-fg/25 bg-diff-hunk-bg text-diff-hunk-fg",
  },
  "dont-flag": {
    label: "Don't flag",
    icon: FlagOffIcon,
    className: "border-border bg-muted text-muted-foreground",
  },
};

export const KindChip = ({
  kind,
  className,
}: {
  readonly kind: PreferenceKind;
  readonly className?: string;
}) => {
  const { label, icon: Icon, className: tint } = KIND[kind];
  return (
    <span
      data-slot="preference-kind"
      data-kind={kind}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-caption font-medium whitespace-nowrap",
        tint,
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {label}
    </span>
  );
};

export const SOURCE: Readonly<Record<PreferenceSource, string>> = {
  written: "written",
  learned: "learned",
  imported: "imported",
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
