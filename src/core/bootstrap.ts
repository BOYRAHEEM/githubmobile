import { Runner } from '../../modules/runner';
import {
  BASE_PACKAGES, GIT_CRED, GIT_CRED_PATH, NET_FIX, NET_FIX_PATH, PROFILE, PROFILE_PATH,
  RUNNER_LIB, RUNNER_LIB_PATH, STEP_PRELUDE,
} from '../runtimes/shell';
import { runToEnd } from './sessions';

/**
 * First-run setup: download Debian, unpack it, install the base tools.
 * Safe to call again – finished steps are skipped.
 */

/** Where the root filesystem comes from. proot-distro publishes ready-made ones. */
const ROOTFS_RELEASES = 'https://api.github.com/repos/termux/proot-distro/releases';
const ROOTFS_PATTERN = /^debian-[a-z]+-aarch64-pd-v[\d.]+\.tar\.xz$/;

export type BootstrapProgress = { step: string; fraction: number | null; log?: string };

type Release = {
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string; digest?: string | null }[];
};

/**
 * Finds the newest stable Debian arm64 rootfs. GitHub reports each asset's
 * SHA-256 ("sha256:…"), which the native side checks after downloading.
 */
export async function resolveRootfs(): Promise<{ url: string; sha256: string | null }> {
  const res = await fetch(`${ROOTFS_RELEASES}?per_page=10`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (res.status === 403) throw new Error('GitHub is rate-limiting this network. Wait a few minutes and try again.');
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
  const releases: Release[] = await res.json();
  for (const rel of releases) {
    if (rel.draft || rel.prerelease) continue;
    const asset = rel.assets.find((a) => ROOTFS_PATTERN.test(a.name));
    if (asset) {
      const sha256 = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : null;
      return { url: asset.browser_download_url, sha256 };
    }
  }
  throw new Error('No Debian arm64 image found in proot-distro releases');
}

/** Writes the helper scripts. Re-run on every launch so updates ship with the app. */
export async function installHelpers() {
  await Runner.writeText(RUNNER_LIB_PATH, RUNNER_LIB);
  await Runner.writeText(NET_FIX_PATH, NET_FIX);
  await Runner.writeText(GIT_CRED_PATH, GIT_CRED);
  await Runner.writeText(PROFILE_PATH, PROFILE);
}

export async function bootstrap(onProgress: (p: BootstrapProgress) => void) {
  const info = Runner.getInfo();
  if (!info.abi.startsWith('arm64')) {
    throw new Error(`This phone is ${info.abi}; only 64-bit ARM phones are supported for now.`);
  }
  if (!info.hasProot) {
    throw new Error('proot is missing from this build. Run `npm run fetch-binaries` and rebuild the app.');
  }

  // 1. Download + unpack Debian.
  if (!info.rootfsReady) {
    onProgress({ step: 'Finding Linux image…', fraction: null });
    const { url, sha256 } = await resolveRootfs();

    const sub = Runner.addListener('onBootstrapProgress', (e) => {
      const fraction = e.total > 0 ? e.done / e.total : null;
      onProgress({ step: e.message, fraction });
    });
    try {
      await Runner.installRootfs(url, sha256);
    } finally {
      sub.remove();
    }
  }

  // 2. Helpers + base packages (git, curl, …).
  await installHelpers();
  onProgress({ step: 'Installing git and base tools…', fraction: null });
  const code = await runToEnd({
    label: 'Setup',
    script: `${STEP_PRELUDE}apt_need ${BASE_PACKAGES.join(' ')}`,
    cwd: '/root',
    onOutput: (chunk) => onProgress({ step: 'Installing git and base tools…', fraction: null, log: chunk }),
  });
  if (code !== 0) throw new Error(`Installing base tools failed (exit ${code})`);

  onProgress({ step: 'Ready', fraction: 1 });
}
