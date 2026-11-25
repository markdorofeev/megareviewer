export {
  type Clone,
  type CloneSearch,
  createCloneSearch,
  stoppedReason,
  type Walk,
} from "./clone-search.ts";
export { type FolderEntry, type Folders, nodeFolders } from "./folders.ts";
export {
  type CheckoutInfo,
  createGitCheckout,
  createGitCheckouts,
  inspectCheckout,
} from "./git-checkout.ts";
export { GIT_NEEDED, installedGit, isNewEnough } from "./git-version.ts";
export { type HostCredentials, type RemoteFor, remotesFor } from "./remote.ts";
export { repoOfRemote } from "./remotes.ts";
export {
  type CopyInfo,
  createRepositoryCopies,
  type GitRepositoryCopies,
} from "./repository-copies.ts";
export { type GitOutput, type RunGit, runGit } from "./run-git.ts";
export type { RunSpotlight } from "./spotlight.ts";
