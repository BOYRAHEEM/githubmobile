import { Runner } from '../../modules/runner';

/**
 * Remembers whether a project's dependencies are installed, and for which
 * version of its dependency files. After a `git pull` that changes
 * package.json or a lockfile, the next Run reinstalls automatically.
 *
 * Kept in /root/.repo-runner (not in the repo) so `git status` stays clean.
 */

const DEP_FILES = [
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb',
  'requirements.txt', 'pyproject.toml', 'poetry.lock', 'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock',
];

const stateFile = (projectId: string) => `/root/.repo-runner/installed/${projectId}`;

/** FNV-1a hash: tiny, fast, good enough to notice a changed file. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Fingerprint of every dependency file present in the repo root. */
export async function dependencySignature(dir: string): Promise<string> {
  const parts = await Promise.all(
    DEP_FILES.map(async (f) => {
      const text = await Runner.readText(`${dir}/${f}`).catch(() => null);
      return text === null ? '' : `${f}:${text.length}:${hash(text)}`;
    }),
  );
  return parts.filter(Boolean).join('|');
}

export async function isInstalled(projectId: string, signature: string) {
  return (await Runner.readText(stateFile(projectId)).catch(() => null)) === signature;
}

export const markInstalled = (projectId: string, signature: string) =>
  Runner.writeText(stateFile(projectId), signature);

export const forgetInstalled = (projectId: string) => Runner.remove(stateFile(projectId)).catch(() => false);
