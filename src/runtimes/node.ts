import { STEP_PRELUDE } from './shell';
import type { Detection, PackageJson, RepoContext, RuntimePlugin } from './types';

/**
 * Node.js projects: plain Node, Next.js, Vite, CRA, Express…
 * Picks the package manager from the lockfile and the Node version from
 * .nvmrc / .node-version / engines.node.
 */

type PM = 'npm' | 'pnpm' | 'yarn';

const DEFAULT_NODE = '22';

function pickPackageManager(ctx: RepoContext): PM {
  const declared = ctx.packageJson?.packageManager?.split('@')[0];
  if (declared === 'pnpm' || declared === 'yarn') return declared;
  if (ctx.has('pnpm-lock.yaml')) return 'pnpm';
  if (ctx.has('yarn.lock')) return 'yarn';
  return 'npm';
}

/**
 * .nvmrc / .node-version pin a version ("20", "v20.11.1"). engines.node is a
 * range: "^18" or "18.x" means 18, but ">=18" only sets a minimum, so we use
 * the default when it is new enough.
 */
async function pickNodeMajor(ctx: RepoContext): Promise<string> {
  const pinned = ((await ctx.read('.nvmrc')) ?? (await ctx.read('.node-version')))?.trim();
  if (pinned) {
    if (/lts|node|stable/i.test(pinned)) return DEFAULT_NODE;
    return pinned.match(/(\d+)/)?.[1] ?? DEFAULT_NODE;
  }
  const range = ctx.packageJson?.engines?.node?.trim();
  if (!range) return DEFAULT_NODE;
  const first = Number(range.match(/(\d+)/)?.[1]);
  if (!first) return DEFAULT_NODE;
  if (/^>=?\s*\d/.test(range)) return String(Math.max(first, Number(DEFAULT_NODE)));
  return String(first);
}

function pickFramework(pkg: PackageJson): string | null {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.next) return 'Next.js';
  if (deps.vite) return 'Vite';
  if (deps['react-scripts']) return 'Create React App';
  if (deps['@remix-run/dev']) return 'Remix';
  if (deps.astro) return 'Astro';
  if (deps.nuxt) return 'Nuxt';
  if (deps['@sveltejs/kit']) return 'SvelteKit';
  if (deps.express || deps.fastify || deps.koa || deps.hono) return 'Node server';
  return null;
}

/** dev > start > serve, falling back to `node index.js`. */
function pickScript(pkg: PackageJson): string | null {
  for (const name of ['dev', 'start', 'serve', 'preview']) {
    if (pkg.scripts?.[name]) return name;
  }
  return null;
}

export const nodePlugin: RuntimePlugin = {
  id: 'node',
  name: 'Node.js',

  async detect(ctx) {
    const pkg = ctx.packageJson;
    if (!pkg) return null;

    const pm = pickPackageManager(ctx);
    const major = await pickNodeMajor(ctx);
    const framework = pickFramework(pkg);
    const script = pickScript(pkg);

    const det: Detection = {
      pluginId: 'node',
      confidence: 60,
      label: [framework, pm, `Node ${major}`].filter(Boolean).join(' · '),
      reason: `Found package.json${pm !== 'npm' ? ` and a ${pm} lockfile` : ''}`,
      meta: { pm, major, framework: framework ?? '', script: script ?? '' },
    };
    return det;
  },

  plan(det, { port }) {
    const { pm, major, framework, script } = det.meta;

    // pnpm/yarn are installed globally through npm the first time.
    const ensurePm = pm === 'npm' ? '' : `command -v ${pm} >/dev/null || npm install -g ${pm}\n`;
    const installCmd = { npm: 'npm install', pnpm: 'pnpm install', yarn: 'yarn install' }[pm as PM];

    // npm needs `--` before extra args; pnpm and yarn pass them straight through.
    const sep = pm === 'npm' ? ' --' : '';

    // Make dev servers listen where the in-app preview can reach them.
    let start: string;
    if (!script) {
      start = 'node index.js';
    } else if (framework === 'Next.js' && script === 'dev') {
      start = `${pm} run dev${sep} -p ${port} -H 127.0.0.1`;
    } else if (framework === 'Vite' && script === 'dev') {
      start = `${pm} run dev${sep} --port ${port} --host 127.0.0.1`;
    } else {
      start = `${pm} run ${script}`;
    }

    return {
      installRuntime: `${STEP_PRELUDE}node_use ${major}\n${ensurePm}`,
      installDeps: `${STEP_PRELUDE}node_use ${major}\n${installCmd}`,
      start: `${STEP_PRELUDE}node_use ${major}\nexec ${start}`,
      env: {
        PORT: String(port),
        HOST: '127.0.0.1',
        BROWSER: 'none',
        // Polling avoids file-watcher limits some phones impose.
        WATCHPACK_POLLING: 'true',
        CHOKIDAR_USEPOLLING: 'true',
        NEXT_TELEMETRY_DISABLED: '1',
      },
    };
  },
};
