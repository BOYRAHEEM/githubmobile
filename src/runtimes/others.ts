import { STEP_PRELUDE } from './shell';
import type { RuntimePlugin } from './types';

/** Go modules: `go run .` */
export const goPlugin: RuntimePlugin = {
  id: 'go',
  name: 'Go',
  async detect(ctx) {
    if (!ctx.has('go.mod')) return null;
    return { pluginId: 'go', confidence: 70, label: 'Go', reason: 'Found go.mod', meta: {} };
  },
  plan(_det, { port }) {
    return {
      installRuntime: `${STEP_PRELUDE}go_use`,
      installDeps: `${STEP_PRELUDE}go_use\ngo mod download`,
      start: `${STEP_PRELUDE}go_use\nexec go run .`,
      env: { PORT: String(port) },
    };
  },
};

/** Rust crates: `cargo run`. First build on a phone is slow. */
export const rustPlugin: RuntimePlugin = {
  id: 'rust',
  name: 'Rust',
  async detect(ctx) {
    if (!ctx.has('Cargo.toml')) return null;
    return { pluginId: 'rust', confidence: 70, label: 'Rust', reason: 'Found Cargo.toml', meta: {} };
  },
  plan(_det, { port }) {
    return {
      installRuntime: `${STEP_PRELUDE}apt_need build-essential\nrust_use`,
      installDeps: `${STEP_PRELUDE}rust_use\ncargo fetch`,
      start: `${STEP_PRELUDE}rust_use\nexec cargo run`,
      env: { PORT: String(port) },
    };
  },
};

/** Plain HTML sites: served with Python's built-in web server. */
export const staticPlugin: RuntimePlugin = {
  id: 'static',
  name: 'Static site',
  async detect(ctx) {
    if (!ctx.has('index.html')) return null;
    return { pluginId: 'static', confidence: 20, label: 'Static HTML', reason: 'Found index.html', meta: {} };
  },
  plan(_det, { port }) {
    return {
      installRuntime: `${STEP_PRELUDE}apt_need python3`,
      installDeps: 'true',
      start: `exec python3 -m http.server ${port} --bind 127.0.0.1`,
      env: {},
    };
  },
};
