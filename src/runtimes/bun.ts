import { STEP_PRELUDE } from './shell';
import type { RuntimePlugin } from './types';

/** Bun projects: picked over Node when a Bun lockfile is present. */
export const bunPlugin: RuntimePlugin = {
  id: 'bun',
  name: 'Bun',

  async detect(ctx) {
    const lock = ctx.has('bun.lockb') || ctx.has('bun.lock');
    const declared = ctx.packageJson?.packageManager?.startsWith('bun');
    if (!lock && !declared) return null;

    const scripts = ctx.packageJson?.scripts ?? {};
    const script = ['dev', 'start', 'serve'].find((s) => scripts[s]) ?? '';
    const entry = ['index.ts', 'index.js', 'src/index.ts'].find((f) => ctx.has(f.split('/')[0])) ?? 'index.ts';

    return {
      pluginId: 'bun',
      confidence: 80, // beats the generic Node plugin
      label: 'Bun',
      reason: lock ? 'Found a Bun lockfile' : 'package.json declares Bun',
      meta: { script, entry },
    };
  },

  plan(det, { port }) {
    const start = det.meta.script ? `bun run ${det.meta.script}` : `bun ${det.meta.entry}`;
    return {
      installRuntime: `${STEP_PRELUDE}bun_use`,
      installDeps: `${STEP_PRELUDE}bun_use\nbun install`,
      start: `${STEP_PRELUDE}bun_use\nexec ${start}`,
      env: { PORT: String(port), HOST: '127.0.0.1' },
    };
  },
};
