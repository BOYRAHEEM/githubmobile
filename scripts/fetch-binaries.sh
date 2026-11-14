#!/usr/bin/env bash
# Downloads the arm64 proot binaries from the Termux package repo and drops them
# into the native module's jniLibs folder, renamed to lib*.so so Android packs
# them and extracts them to an executable location.
#
# Runs automatically on EAS Build (eas-build-pre-install). Locally, run it from
# Linux, macOS or WSL:  npm run fetch-binaries
#
# Needs: curl, ar (binutils), tar with xz, and patchelf (pip install patchelf).
set -euo pipefail

REPO="https://packages.termux.dev/apt/termux-main"
OUT="$(cd "$(dirname "$0")/.." && pwd)/modules/runner/android/src/main/jniLibs/arm64-v8a"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ -f "$OUT/libproot.so" ] && [ -f "$OUT/libproot-loader.so" ] && [ -f "$OUT/libtalloc.so" ]; then
  echo "proot binaries already present in $OUT"
  exit 0
fi

# patchelf is used to make proot look for libtalloc.so instead of libtalloc.so.2
if ! command -v patchelf >/dev/null 2>&1; then
  python3 -m pip install --quiet --user patchelf || pip install --quiet patchelf
  export PATH="$HOME/.local/bin:$PATH"
fi

echo "Reading Termux package index…"
curl -fsSL "$REPO/dists/stable/main/binary-aarch64/Packages" -o "$WORK/Packages"

# sha256sum on Linux/WSL, shasum on macOS.
sha256_check() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum -c --status; else shasum -a 256 -c -s; fi
}

# Prints a field (Filename, SHA256, …) of a package from the index.
deb_field() {
  awk -v pkg="$1" -v field="$2:" '
    $1=="Package:" { p=$2 }
    p==pkg && $1==field { print $2; exit }
  ' "$WORK/Packages"
}

fetch_deb() {
  local name="$1" path sum
  path="$(deb_field "$name" Filename)"
  sum="$(deb_field "$name" SHA256)"
  [ -n "$path" ] && [ -n "$sum" ] || { echo "Package $name not found in index" >&2; exit 1; }
  echo "Downloading $name ($path)"
  mkdir -p "$WORK/$name"
  curl -fsSL "$REPO/$path" -o "$WORK/$name/pkg.deb"
  # The index is fetched over HTTPS; check each package against it.
  echo "$sum  $WORK/$name/pkg.deb" | sha256_check || { echo "Checksum mismatch for $name" >&2; exit 1; }
  (cd "$WORK/$name" && ar x pkg.deb && tar -xf data.tar.*)
}

fetch_deb proot
fetch_deb libtalloc

PREFIX="data/data/com.termux/files/usr"
mkdir -p "$OUT"
cp "$WORK/proot/$PREFIX/bin/proot"              "$OUT/libproot.so"
cp "$WORK/proot/$PREFIX/libexec/proot/loader"   "$OUT/libproot-loader.so"
cp "$(ls "$WORK"/libtalloc/$PREFIX/lib/libtalloc.so.* | head -1)" "$OUT/libtalloc.so"

patchelf --replace-needed libtalloc.so.2 libtalloc.so "$OUT/libproot.so"
patchelf --remove-rpath "$OUT/libproot.so" || true
chmod 755 "$OUT"/*.so

echo "Done:"
ls -la "$OUT"
