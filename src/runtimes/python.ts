import { STEP_PRELUDE } from './shell';
import type { RuntimePlugin } from './types';

/**
 * Python projects. Dependencies go into a per-project .venv so projects
 * don't clash. Recognises Django, Flask, FastAPI and Streamlit start commands.
 */
export const pythonPlugin: RuntimePlugin = {
  id: 'python',
  name: 'Python',

  async detect(ctx) {
    const req = ctx.has('requirements.txt');
    const pyproject = ctx.has('pyproject.toml');
    const entry = ['manage.py', 'app.py', 'main.py', 'server.py', 'run.py'].find((f) => ctx.has(f));
    if (!req && !pyproject && !entry) return null;

    const deps = ((await ctx.read('requirements.txt')) ?? '') + ((await ctx.read('pyproject.toml')) ?? '');
    const lower = deps.toLowerCase();
    const framework = entry === 'manage.py' || lower.includes('django')
      ? 'Django'
      : lower.includes('streamlit') ? 'Streamlit'
      : lower.includes('fastapi') ? 'FastAPI'
      : lower.includes('flask') ? 'Flask'
      : '';

    return {
      pluginId: 'python',
      confidence: ctx.packageJson ? 40 : 70, // a package.json usually means a JS app
      label: ['Python', framework].filter(Boolean).join(' · '),
      reason: req ? 'Found requirements.txt' : pyproject ? 'Found pyproject.toml' : `Found ${entry}`,
      meta: { framework, entry: entry ?? 'main.py', req: req ? '1' : '', pyproject: pyproject ? '1' : '' },
    };
  },

  plan(det, { port }) {
    const { framework, entry, req, pyproject } = det.meta;
    const venv = 'test -d .venv || python3 -m venv .venv\nsource .venv/bin/activate';

    const install = req ? 'pip install -r requirements.txt' : pyproject ? 'pip install -e .' : 'true';

    const app = entry.replace(/\.py$/, '');
    const start = {
      Django: `python manage.py runserver 127.0.0.1:${port}`,
      Streamlit: `streamlit run ${entry} --server.port ${port} --server.address 127.0.0.1 --server.headless true`,
      FastAPI: `uvicorn ${app}:app --host 127.0.0.1 --port ${port} --reload`,
      Flask: `flask --app ${app} run --host 127.0.0.1 --port ${port} --debug`,
    }[framework] ?? `python ${entry}`;

    return {
      installRuntime: `${STEP_PRELUDE}apt_need python3 python3-venv python3-pip python3-dev build-essential`,
      installDeps: `${STEP_PRELUDE}${venv}\npip install --upgrade pip\n${install}`,
      start: `${STEP_PRELUDE}${venv}\nexec ${start}`,
      env: { PORT: String(port), PYTHONUNBUFFERED: '1' },
    };
  },
};
