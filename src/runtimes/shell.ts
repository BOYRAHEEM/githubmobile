/**
 * Shell helpers installed into the Linux environment at /opt/runner.
 * Plugins call these instead of repeating download logic.
 */

export const RUNNER_LIB_PATH = '/opt/runner/lib.sh';
export const NET_FIX_PATH = '/opt/runner/hooks/android-net-fix.js';
export const GIT_CRED_PATH = '/opt/runner/git-credential.sh';
export const PROFILE_PATH = '/etc/profile.d/runner.sh';

/**
 * git credential helper: answers "get" for github.com with the token the app
 * passes in RUNNER_GH_TOKEN. Nothing is stored on disk.
 */
export const GIT_CRED = `#!/bin/sh
[ "$1" = get ] || exit 0
[ -n "$RUNNER_GH_TOKEN" ] || exit 0
host=""
while IFS='=' read -r key value; do
  [ -z "$key" ] && break
  [ "$key" = host ] && host="$value"
done
[ "$host" = github.com ] || exit 0
echo username=x-access-token
echo "password=$RUNNER_GH_TOKEN"
`;

/** Login-shell setup: puts installed runtimes on PATH and sets a short prompt. */
export const PROFILE = String.raw`# Repo Runner
for d in /opt/runtimes/node-*/bin /opt/runtimes/go/bin "$HOME/.bun/bin" "$HOME/.cargo/bin" "$HOME/go/bin"; do
  [ -d "$d" ] && case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac
done
export PATH
if [ -n "$PS1" ]; then
  PS1='\[\e[32m\]\w\[\e[0m\] $ '
  alias ls='ls --color=auto'
  alias ll='ls -la --color=auto'
fi
`;

export const RUNNER_LIB = String.raw`#!/bin/bash
# Shared helpers for Repo Runner. Sourced by every run step.

log() { printf '\033[36m[runner]\033[0m %s\n' "$*"; }

# apt_need pkg1 pkg2 … – installs only what is missing.
apt_need() {
  local missing=()
  for p in "$@"; do dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p"); done
  [ ${'$'}{#missing[@]} -eq 0 ] && return 0
  log "Installing ${'$'}{missing[*]}"
  # Refresh package lists if they're missing or older than a day.
  if [ -z "$(find /var/lib/apt/lists -maxdepth 1 -name .runner-updated -mtime -1 2>/dev/null)" ]; then
    apt-get update -y && touch /var/lib/apt/lists/.runner-updated
  fi
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${'$'}{missing[@]}" || {
    # Stale lists give 404s: refresh once and retry.
    apt-get update -y && touch /var/lib/apt/lists/.runner-updated
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${'$'}{missing[@]}"
  }
}

# fetch_verified <url> <sha256> <file> – downloads and checks the checksum.
fetch_verified() {
  curl -fsSL --retry 3 -o "$3" "$1"
  echo "$2  $3" | sha256sum -c --status || { echo "Checksum mismatch for $1"; rm -f "$3"; return 1; }
}

# node_use <major> – downloads the official Node build once, then puts it on PATH.
node_use() {
  local major="${'$'}{1:-22}"
  local dir="/opt/runtimes/node-$major"
  if [ ! -x "$dir/bin/node" ]; then
    log "Installing Node $major"
    local base="https://nodejs.org/dist/latest-v${'$'}{major}.x"
    local line file sum
    line=$(curl -fsSL "$base/SHASUMS256.txt" | grep "linux-arm64.tar.xz" | head -1)
    sum=${'$'}{line%% *}
    file=${'$'}{line##* }
    [ -n "$file" ] || { echo "Node $major not found"; return 1; }
    # Download, verify, unpack to a temp folder, then move into place, so an
    # interrupted install never leaves a half-unpacked Node behind.
    fetch_verified "$base/$file" "$sum" "/tmp/$file"
    rm -rf "$dir.tmp" && mkdir -p "$dir.tmp"
    tar -xJf "/tmp/$file" -C "$dir.tmp" --strip-components=1
    rm -f "/tmp/$file"
    rm -rf "$dir" && mv "$dir.tmp" "$dir"
  fi
  export PATH="$dir/bin:$PATH"
  log "Node $(node -v)"
}

# bun_use – installs Bun once.
bun_use() {
  if [ ! -x "$HOME/.bun/bin/bun" ]; then
    log "Installing Bun"
    curl -fsSL https://bun.sh/install | bash
  fi
  export PATH="$HOME/.bun/bin:$PATH"
  log "Bun $(bun --version)"
}

# go_use – installs the latest Go once.
go_use() {
  if [ ! -x /opt/runtimes/go/bin/go ]; then
    local v
    v=$(curl -fsSL "https://go.dev/VERSION?m=text" | head -1)
    log "Installing $v"
    curl -fsSL --retry 3 -o /tmp/go.tgz "https://go.dev/dl/$v.linux-arm64.tar.gz"
    rm -rf /opt/runtimes/go.tmp && mkdir -p /opt/runtimes/go.tmp
    tar -xzf /tmp/go.tgz -C /opt/runtimes/go.tmp --strip-components=1 && rm -f /tmp/go.tgz
    rm -rf /opt/runtimes/go && mv /opt/runtimes/go.tmp /opt/runtimes/go
  fi
  export PATH="/opt/runtimes/go/bin:$HOME/go/bin:$PATH"
  log "$(go version)"
}

# rust_use – installs Rust through rustup once.
rust_use() {
  if [ ! -x "$HOME/.cargo/bin/cargo" ]; then
    log "Installing Rust"
    curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
  fi
  export PATH="$HOME/.cargo/bin:$PATH"
  log "$(cargo --version)"
}
`;

/**
 * Some Android versions refuse to list network interfaces from inside an app,
 * which crashes Vite, Next.js and others at startup. This patch returns the
 * loopback interface instead of throwing. Loaded through NODE_OPTIONS.
 */
export const NET_FIX = `const os = require('os');
const original = os.networkInterfaces;
os.networkInterfaces = function () {
  try {
    return original.call(os);
  } catch (e) {
    return { lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4',
      mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }] };
  }
};
`;

/** Base packages installed on first boot. */
export const BASE_PACKAGES = ['ca-certificates', 'curl', 'git', 'xz-utils', 'unzip', 'procps'];

/** Prefix for every run step: load helpers, fail fast. */
export const STEP_PRELUDE = `set -e\nsource ${RUNNER_LIB_PATH}\n`;

/** Quotes a value for safe use in a bash command. */
export const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
