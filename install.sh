#!/bin/sh
# Installs the megareviewer command:
#   curl -fsSL https://raw.githubusercontent.com/markdorofeev/megareviewer/main/install.sh | sh
# MEGAREVIEWER_VERSION picks a version, e.g. 0.2.9; the latest by default.
# MEGAREVIEWER_SOURCE=github installs the package from a GitHub release instead of npm.
set -eu

REPO=markdorofeev/megareviewer
# Matches MIN_NODE in src/cli/node-version.ts; a test keeps them equal.
MIN_NODE_MAJOR=22
MIN_NODE_MINOR=13

fail() {
  printf 'megareviewer: %s\n' "$1" >&2
  exit 1
}

say() {
  printf 'megareviewer: %s\n' "$1"
}

version="${MEGAREVIEWER_VERSION:-latest}"
version="${version#v}"
source="${MEGAREVIEWER_SOURCE:-npm}"
case "$source" in
  npm | github) ;;
  *) fail "MEGAREVIEWER_SOURCE is \"$source\"; it can be npm or github." ;;
esac

command -v node >/dev/null 2>&1 ||
  fail "Node $MIN_NODE_MAJOR.$MIN_NODE_MINOR or later is needed. Install the current LTS from https://nodejs.org, then run this again."

node_version="$(node -p process.versions.node)"
node_major="${node_version%%.*}"
node_minor="${node_version#*.}"
node_minor="${node_minor%%.*}"
if [ "$node_major" -lt "$MIN_NODE_MAJOR" ] ||
  { [ "$node_major" -eq "$MIN_NODE_MAJOR" ] && [ "$node_minor" -lt "$MIN_NODE_MINOR" ]; }; then
  fail "megareviewer needs Node $MIN_NODE_MAJOR.$MIN_NODE_MINOR or later, but this is Node $node_version. Install the current LTS from https://nodejs.org, then run this again."
fi

install_from_npm() {
  command -v npm >/dev/null 2>&1 ||
    fail "npm is needed, and comes with Node from https://nodejs.org. Or install from GitHub with MEGAREVIEWER_SOURCE=github."
  # A system Node's global prefix (/usr, /usr/local) is often root's; installing there would
  # need sudo, so the command goes to ~/.local/bin instead.
  prefix="$(npm prefix -g)"
  if [ -w "$prefix/lib/node_modules" ] || { [ ! -e "$prefix/lib/node_modules" ] && [ -w "$prefix" ]; }; then
    bin_dir="$prefix/bin"
    npm install -g "megareviewer@$version"
  else
    prefix="$HOME/.local"
    bin_dir="$prefix/bin"
    say "npm's global folder isn't writable, so installing into $prefix."
    npm install -g --prefix "$prefix" "megareviewer@$version"
  fi
}

# The package has no dependencies, so unpacking it is the whole install.
install_from_github() {
  command -v curl >/dev/null 2>&1 || fail "curl is needed to download from GitHub."
  if [ "$version" = latest ]; then
    url="https://github.com/$REPO/releases/latest/download/megareviewer.tgz"
  else
    url="https://github.com/$REPO/releases/download/v$version/megareviewer.tgz"
  fi
  share_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
  bin_dir="$HOME/.local/bin"
  mkdir -p "$share_dir" "$bin_dir"
  work="$(mktemp -d "$share_dir/megareviewer.download.XXXXXX")"
  trap 'rm -rf "$work"' EXIT

  say "Downloading $url"
  curl -fsSL "$url" -o "$work/megareviewer.tgz" ||
    fail "Couldn't download $url. Releases before 0.2.10 have no package on GitHub."

  # gh checks that the release workflow built the file from this repository; it needs a sign-in.
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    gh attestation verify "$work/megareviewer.tgz" --repo "$REPO" \
      --signer-workflow "$REPO/.github/workflows/release.yml" >/dev/null ||
      fail "The download isn't attested as built from $REPO, so it wasn't installed."
    say "Verified: built from $REPO by GitHub Actions."
  else
    say "Not verified: with the GitHub CLI signed in, this checks the download was built from $REPO."
  fi

  tar -xzf "$work/megareviewer.tgz" -C "$work"
  [ -f "$work/package/dist/cli.js" ] || fail "The download isn't a megareviewer package."
  installed_version="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$work/package/package.json")"

  # Swapped in whole, so a failed download never leaves half an install.
  rm -rf "$share_dir/megareviewer"
  mv "$work/package" "$share_dir/megareviewer"
  chmod +x "$share_dir/megareviewer/dist/cli.js"
  ln -sf "$share_dir/megareviewer/dist/cli.js" "$bin_dir/megareviewer"
  say "Installed megareviewer $installed_version into $share_dir/megareviewer."
}

"install_from_$source"

case ":$PATH:" in
  *":$bin_dir:"*)
    printf '\nInstalled. Run `megareviewer doctor` to check your credentials, then `megareviewer`.\n'
    ;;
  *)
    printf '\nInstalled in %s, which is not on your PATH. Add this to your shell profile:\n\n  export PATH="%s:$PATH"\n\nThen run `megareviewer doctor` to check your credentials, and `megareviewer`.\n' "$bin_dir" "$bin_dir"
    ;;
esac
