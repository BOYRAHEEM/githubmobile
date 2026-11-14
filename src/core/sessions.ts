import { Runner } from '../../modules/runner';
import { GIT_CRED_PATH, NET_FIX_PATH } from '../runtimes/shell';

/**
 * Thin JS layer over the native process API.
 * One global listener fans events out to whoever started each session.
 */

type OutputFn = (chunk: string, stream: 'stdout' | 'stderr') => void;
type ExitFn = (code: number) => void;

const outputHandlers = new Map<string, OutputFn>();
const exitHandlers = new Map<string, ExitFn>();
let wired = false;

function wire() {
  if (wired) return;
  wired = true;
  Runner.addListener('onOutput', (e) => outputHandlers.get(e.id)?.(e.chunk, e.stream));
  Runner.addListener('onExit', (e) => {
    const done = exitHandlers.get(e.id);
    outputHandlers.delete(e.id);
    exitHandlers.delete(e.id);
    done?.(e.code);
  });
}

// ------------------------------------------------------------- environment

/** Environment every session gets on top of its own. */
const BASE_ENV: Record<string, string> = {
  NODE_OPTIONS: `--require=${NET_FIX_PATH}`,
  CI: '', // some tools disable dev servers when CI is set
  GIT_TERMINAL_PROMPT: '0', // fail instead of hanging on a password prompt
};

/**
 * GitHub token for private repos. Handed to git through a credential helper
 * that reads it from the environment, so it is never written inside Linux.
 *
 * Security: repo code (npm install scripts, dev servers) is untrusted and can
 * read its own environment. So the token is only given to sessions that need
 * git: cloning, and the terminal, which the user drives. Install and run
 * steps never see it.
 */
let authEnv: Record<string, string> = {};

export function setGitHubToken(token: string | null) {
  authEnv = token
    ? {
        RUNNER_GH_TOKEN: token,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
        GIT_CONFIG_VALUE_0: `!sh ${GIT_CRED_PATH}`,
      }
    : {};
}

const envFor = (extra?: Record<string, string>, withGitAuth = false) => ({
  ...BASE_ENV,
  ...(withGitAuth ? authEnv : {}),
  ...extra,
});

// ---------------------------------------------------------------- sessions

let counter = 0;
export const newSessionId = (prefix: string) => `${prefix}-${Date.now()}-${counter++}`;

/** Asks once for notification permission so the keep-alive notice can show. */
let askedNotifications = false;
function ensureNotificationPermission() {
  if (askedNotifications) return;
  askedNotifications = true;
  Runner.requestNotificationPermission().catch(() => {});
}

/** Starts a script (install step, dev server…). Resolves once started. */
export async function startProcess(opts: {
  id: string;
  label: string;
  script: string;
  cwd: string;
  env?: Record<string, string>;
  /** Give git the GitHub token (clone/pull only – see setGitHubToken). */
  withGitAuth?: boolean;
  onOutput: OutputFn;
  onExit: ExitFn;
}) {
  wire();
  ensureNotificationPermission();
  outputHandlers.set(opts.id, opts.onOutput);
  exitHandlers.set(opts.id, opts.onExit);
  try {
    await Runner.start(opts.id, opts.label, opts.script, opts.cwd, envFor(opts.env, opts.withGitAuth));
  } catch (e) {
    outputHandlers.delete(opts.id);
    exitHandlers.delete(opts.id);
    throw e;
  }
}

/**
 * Runs a script to completion and resolves with its exit code.
 * Pass `id` to be able to stop it with stopProcess(id).
 */
export function runToEnd(opts: {
  id?: string;
  label: string;
  script: string;
  cwd: string;
  env?: Record<string, string>;
  withGitAuth?: boolean;
  onOutput?: OutputFn;
}): Promise<number> {
  return new Promise((resolve, reject) => {
    startProcess({
      id: opts.id ?? newSessionId('step'),
      withGitAuth: opts.withGitAuth,
      label: opts.label,
      script: opts.script,
      cwd: opts.cwd,
      env: opts.env,
      onOutput: opts.onOutput ?? (() => {}),
      onExit: resolve,
    }).catch(reject);
  });
}

/** Starts an interactive shell on a real terminal. */
export async function startTerminal(opts: {
  id: string;
  cwd: string;
  rows: number;
  cols: number;
  onOutput: OutputFn;
  onExit: ExitFn;
}) {
  wire();
  ensureNotificationPermission();
  outputHandlers.set(opts.id, opts.onOutput);
  exitHandlers.set(opts.id, opts.onExit);
  // The terminal is user-driven and needs git push/pull, so it gets the token.
  await Runner.startTerminal(opts.id, opts.cwd, envFor(undefined, true), opts.rows, opts.cols);
}

export const stopProcess = (id: string) => Runner.stop(id);

/** Stops leftovers from before a JS reload; their output can't reach us any more. */
export const stopAllProcesses = () => Runner.stopAll().catch(() => {});
export const writeToProcess = (id: string, data: string) => Runner.write(id, data);
export const resizeTerminal = (id: string, rows: number, cols: number) => Runner.resize(id, rows, cols);
