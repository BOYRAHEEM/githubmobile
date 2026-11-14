import { Runner } from '../../modules/runner';
import { bunPlugin } from './bun';
import { nodePlugin } from './node';
import { goPlugin, rustPlugin, staticPlugin } from './others';
import { pythonPlugin } from './python';
import type { Detection, PackageJson, RepoContext, RuntimePlugin } from './types';

/** Every supported runtime. Add new plugins here. */
export const PLUGINS: RuntimePlugin[] = [
  bunPlugin,
  nodePlugin,
  pythonPlugin,
  goPlugin,
  rustPlugin,
  staticPlugin,
];

export const getPlugin = (id: string) => PLUGINS.find((p) => p.id === id);

/** Reads the repo root once and builds the context every plugin shares. */
export async function buildRepoContext(dir: string): Promise<RepoContext> {
  const entries = await Runner.listDir(dir);
  const files = entries.map((e) => e.name);
  const read = (name: string) => Runner.readText(`${dir}/${name}`);

  let packageJson: PackageJson | null = null;
  const raw = await read('package.json');
  if (raw) {
    try {
      packageJson = JSON.parse(raw);
    } catch {
      // Broken package.json – leave it null and let other plugins try.
    }
  }

  return { dir, files, has: (n) => files.includes(n), read, packageJson };
}

/** Runs every plugin and returns matches, best first. */
export async function detectRuntimes(dir: string): Promise<Detection[]> {
  const ctx = await buildRepoContext(dir);
  const results = await Promise.all(PLUGINS.map((p) => p.detect(ctx).catch(() => null)));
  return results
    .filter((d): d is Detection => d !== null)
    .sort((a, b) => b.confidence - a.confidence);
}
