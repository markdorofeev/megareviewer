import type { HostKind, RepoRef } from "../../domain/review/index.ts";

/** Where a repository is downloaded from, and who as. */
export interface GitRemote {
  readonly url: string;
  readonly user: { readonly name: string; readonly password: string };
}

/** Null for a repository whose host has no credentials. */
export type RemoteFor = (repo: RepoRef) => GitRemote | null;

/** The credentials megareviewer holds for each host's API. */
export interface HostCredentials {
  readonly github: { readonly token: string } | null;
  readonly bitbucket: { readonly username: string; readonly password: string } | null;
}

/**
 * Who the credentials sign in to git as. Bitbucket's API takes an API token with the user's email,
 * and its git refuses the email and asks for this name instead. An app password's username works
 * for both. What's an API token is told by the username, since one set up where app passwords used
 * to be works with the API too.
 */
const bitbucketUser = (username: string): string =>
  username.includes("@") ? "x-bitbucket-api-token-auth" : username;

export const remotesFor =
  ({ github, bitbucket }: HostCredentials): RemoteFor =>
  ({ host, owner, repo }) => {
    switch (host) {
      case "github":
        return github === null
          ? null
          : {
              url: `https://github.com/${owner}/${repo}.git`,
              user: { name: "x-access-token", password: github.token },
            };
      case "bitbucket":
        return bitbucket === null
          ? null
          : {
              url: `https://bitbucket.org/${owner}/${repo}.git`,
              user: { name: bitbucketUser(bitbucket.username), password: bitbucket.password },
            };
    }
  };

export const HOST_NAMES: Readonly<Record<HostKind, string>> = {
  github: "GitHub",
  bitbucket: "Bitbucket",
};

const basic = ({ name, password }: GitRemote["user"]): string =>
  Buffer.from(`${name}:${password}`).toString("base64");

/** Text git printed, with the credentials taken out should it ever print them. */
export const withoutCredentials = (text: string, remote: GitRemote | null): string =>
  remote === null
    ? text
    : text.replaceAll(remote.user.password, "***").replaceAll(basic(remote.user), "***");

/** What git and the system need from the server's environment, and nothing that configures git. */
const KEPT = [
  "PATH",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "DEVELOPER_DIR",
  // A reviewer behind a proxy, or a certificate authority of their own.
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "CURL_CA_BUNDLE",
] as const;

/**
 * The environment git downloads in: none of the reviewer's or the system's git config, one
 * protocol, no redirect followed, no credential helper, no prompt, and the credentials for the
 * remote's own origin only. `home` holds no `.netrc`, which git would read credentials from.
 */
export const downloadEnv = (options: {
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  /** Null for a command that talks to no remote. */
  readonly remote: GitRemote | null;
  readonly protocol: string;
}): Record<string, string> => {
  const { env, home, remote, protocol } = options;
  const config: (readonly [string, string])[] = [
    ["protocol.allow", "never"],
    [`protocol.${protocol}.allow`, "always"],
    ["http.followRedirects", "false"],
    ["credential.helper", ""],
    ["core.hooksPath", "/dev/null"],
    ["gc.auto", "0"],
    ["maintenance.auto", "false"],
    ["fetch.recurseSubmodules", "false"],
  ];
  if (remote?.url.startsWith("https://")) {
    const { origin } = new URL(remote.url);
    config.push([`http.${origin}/.extraHeader`, `Authorization: Basic ${basic(remote.user)}`]);
  }
  return {
    ...Object.fromEntries(
      KEPT.flatMap((name) => {
        const value = env[name];
        return value === undefined ? [] : [[name, value] as const];
      }),
    ),
    HOME: home,
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ALLOW_PROTOCOL: protocol,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    GIT_CONFIG_COUNT: String(config.length),
    ...Object.fromEntries(
      config.flatMap(([key, value], at) => [
        [`GIT_CONFIG_KEY_${at}`, key] as const,
        [`GIT_CONFIG_VALUE_${at}`, value] as const,
      ]),
    ),
  };
};
