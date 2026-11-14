import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Runner } from '../../modules/runner';
import { bootstrap, installHelpers } from '../core/bootstrap';
import { clearToken, fetchUser, GitHubUser, loadToken, saveToken } from '../core/github';
import { dependencySignature, forgetInstalled, isInstalled, markInstalled } from '../core/installState';
import { appendOutput, EMPTY_LOG, LogState } from '../core/logs';
import { findPort, probePort, stripAnsi } from '../core/ports';
import { cloneProject, deleteProject, loadProjects, Project, saveProjects } from '../core/projects';
import {
  newSessionId, runToEnd, setGitHubToken, startProcess, stopAllProcesses, stopProcess,
} from '../core/sessions';
import { detectRuntimes, getPlugin } from '../runtimes/registry';
import type { Detection } from '../runtimes/types';

/**
 * App-wide state: is Linux installed, which projects exist, and what each
 * project is doing right now. Screens read from here instead of talking to
 * the native module directly.
 */

export type EnvStatus = 'checking' | 'needs-setup' | 'setting-up' | 'ready' | 'error';

export type RunPhase = 'idle' | 'installing-runtime' | 'installing-deps' | 'starting' | 'running' | 'stopped' | 'failed';

export type RunState = {
  phase: RunPhase;
  logs: string;
  port: number | null;
  /** The dev-server session, once started. */
  sessionId: string | null;
  detections: Detection[];
};

const EMPTY_RUN: RunState = { phase: 'idle', logs: '', port: null, sessionId: null, detections: [] };
const LOG_FLUSH_MS = 100; // batch output so a chatty npm install doesn't re-render per line
const PROBE_EVERY_MS = 2000;
const PROBE_FOR_MS = 15 * 60_000;
const MAX_LOG = 150_000; // characters kept per project

type Ctx = {
  envStatus: EnvStatus;
  envError: string | null;
  setup: { step: string; fraction: number | null; log: string };
  startSetup(): Promise<void>;

  projects: Project[];
  addProject(url: string, onLog: (s: string) => void): Promise<Project>;
  removeProject(id: string): Promise<void>;

  github: { user: GitHubUser | null; token: string | null };
  signIn(token: string): Promise<GitHubUser>;
  signOut(): Promise<void>;

  runs: Record<string, RunState>;
  detect(project: Project): Promise<Detection[]>;
  setPlugin(project: Project, pluginId: string): Promise<void>;
  run(project: Project, opts?: { reinstall?: boolean }): Promise<void>;
  stop(project: Project): Promise<void>;
  clearLogs(project: Project): void;
};

const RunnerCtx = createContext<Ctx | null>(null);

function readInitialStatus(): { status: EnvStatus; error: string | null } {
  try {
    return { status: Runner.getInfo().rootfsReady ? 'checking' : 'needs-setup', error: null };
  } catch {
    // Happens in Expo Go or on web, where the native module doesn't exist.
    return { status: 'error', error: 'The Runner native module is not available. Use a development build on Android.' };
  }
}

export function RunnerProvider({ children }: { children: React.ReactNode }) {
  // Decide the starting status synchronously from what is on disk.
  const [initial] = useState(readInitialStatus);
  const [envStatus, setEnvStatus] = useState<EnvStatus>(initial.status);
  const [envError, setEnvError] = useState<string | null>(initial.error);
  const [setup, setSetup] = useState({ step: '', fraction: null as number | null, log: '' });
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [github, setGithub] = useState<{ user: GitHubUser | null; token: string | null }>({ user: null, token: null });

  // Latest projects for callbacks that outlive a render.
  const projectsRef = useRef(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  // ---------------------------------------------------------------- boot

  // Linux is installed: refresh helper scripts, then load saved projects.
  useEffect(() => {
    if (initial.status !== 'checking') return;
    stopAllProcesses() // processes from before a JS reload can't report back to us
      .then(installHelpers)
      .then(loadProjects)
      .then((p) => {
        projectsRef.current = p;
        setProjects(p);
        setEnvStatus('ready');
      })
      .catch((e) => {
        setEnvError(String(e?.message ?? e));
        setEnvStatus('error');
      });
  }, [initial.status]);

  // Restore the GitHub session. The token works for git even if /user fails offline.
  useEffect(() => {
    loadToken()
      .then(async (token) => {
        if (!token) return;
        setGitHubToken(token);
        setGithub({ token, user: null });
        const user = await fetchUser(token).catch(() => null);
        setGithub({ token, user });
      })
      .catch(() => {});
  }, []);

  const signIn = useCallback(async (token: string) => {
    const user = await fetchUser(token.trim()); // throws if the token is bad
    await saveToken(token.trim());
    setGitHubToken(token.trim());
    setGithub({ token: token.trim(), user });
    return user;
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    setGitHubToken(null);
    setGithub({ token: null, user: null });
  }, []);

  const startSetup = useCallback(async () => {
    setEnvStatus('setting-up');
    setEnvError(null);
    try {
      await bootstrap((p) =>
        setSetup((s) => ({
          step: p.step,
          fraction: p.fraction,
          log: p.log ? (s.log + stripAnsi(p.log)).slice(-20_000) : s.log,
        })),
      );
      setProjects(await loadProjects());
      setEnvStatus('ready');
    } catch (e: any) {
      setEnvError(String(e?.message ?? e));
      setEnvStatus('needs-setup');
    }
  }, []);

  // ------------------------------------------------------------ projects

  const persist = useCallback(async (next: Project[]) => {
    projectsRef.current = next;
    setProjects(next);
    await saveProjects(next);
  }, []);

  const addProject = useCallback(
    async (url: string, onLog: (s: string) => void) => {
      const project = await cloneProject(url, projectsRef.current, onLog);
      const detections = await detectRuntimes(project.dir);
      project.pluginId = detections[0]?.pluginId;
      await persist([project, ...projectsRef.current]);
      setRuns((r) => ({ ...r, [project.id]: { ...EMPTY_RUN, detections } }));
      return project;
    },
    [persist],
  );

  // ---------------------------------------------------------------- runs

  /** Merges a change into one project's run state. */
  const patchRun = useCallback((id: string, patch: Partial<RunState> | ((r: RunState) => Partial<RunState>)) => {
    setRuns((all) => {
      const cur = all[id] ?? EMPTY_RUN;
      const change = typeof patch === 'function' ? patch(cur) : patch;
      return { ...all, [id]: { ...cur, ...change } };
    });
  }, []);

  // Per-project bookkeeping that must not wait for a re-render.
  const live = useRef<Record<string, { session: string | null; cancelled: boolean; log: LogState }>>({});
  const liveFor = (id: string) => (live.current[id] ??= { session: null, cancelled: false, log: EMPTY_LOG });

  // Output is collected here and flushed into state every LOG_FLUSH_MS.
  const pendingOutput = useRef<Record<string, string>>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushLogs = useCallback(() => {
    flushTimer.current = null;
    const pending = pendingOutput.current;
    pendingOutput.current = {};
    setRuns((all) => {
      const next = { ...all };
      for (const [id, chunk] of Object.entries(pending)) {
        const cur = next[id] ?? EMPTY_RUN;
        const l = liveFor(id);
        l.log = appendOutput(l.log, chunk, MAX_LOG);
        const watching = cur.phase === 'starting' || cur.phase === 'running';
        const port = cur.port ?? (watching ? findPort(chunk) : null);
        next[id] = {
          ...cur,
          logs: l.log.text,
          port,
          phase: port && cur.phase === 'starting' ? 'running' : cur.phase,
        };
      }
      return next;
    });
  }, []);

  const appendLog = useCallback(
    (id: string, text: string) => {
      pendingOutput.current[id] = (pendingOutput.current[id] ?? '') + text;
      flushTimer.current ??= setTimeout(flushLogs, LOG_FLUSH_MS);
    },
    [flushLogs],
  );

  const resetLog = useCallback((id: string) => {
    liveFor(id).log = EMPTY_LOG;
    delete pendingOutput.current[id];
  }, []);

  const detect = useCallback(
    async (project: Project) => {
      const detections = await detectRuntimes(project.dir);
      patchRun(project.id, { detections });
      return detections;
    },
    [patchRun],
  );

  const setPlugin = useCallback(
    async (project: Project, pluginId: string) => {
      await persist(projectsRef.current.map((p) => (p.id === project.id ? { ...p, pluginId } : p)));
    },
    [persist],
  );

  /** For servers that never print their URL: poll the assigned port until it answers. */
  const watchPort = useCallback(
    async (id: string, sessionId: string, port: number) => {
      const until = Date.now() + PROBE_FOR_MS;
      while (Date.now() < until && liveFor(id).session === sessionId) {
        await new Promise((r) => setTimeout(r, PROBE_EVERY_MS));
        if (liveFor(id).session !== sessionId) return;
        if (await probePort(port)) {
          patchRun(id, (r) => (r.sessionId === sessionId && !r.port ? { port, phase: 'running' } : {}));
          return;
        }
      }
    },
    [patchRun],
  );

  const run = useCallback(
    async (project: Project, opts?: { reinstall?: boolean }) => {
      const id = project.id;
      const l = liveFor(id);
      if (l.session) return; // already running or installing
      l.cancelled = false;
      resetLog(id);
      patchRun(id, { phase: 'installing-runtime', port: null, logs: '', sessionId: null });
      const log = (s: string) => appendLog(id, s);

      try {
        const detections = await detect(project);
        const det = detections.find((d) => d.pluginId === project.pluginId) ?? detections[0];
        const plugin = det && getPlugin(det.pluginId);
        if (!det || !plugin) {
          log("Couldn't tell what this repo needs. Open the terminal to run it by hand.\n");
          patchRun(id, { phase: 'failed' });
          return;
        }
        const plan = plugin.plan(det, { port: project.port });
        if (l.cancelled) return;

        // Install dependencies on the first run, or when their files changed.
        const signature = await dependencySignature(project.dir);
        const needDeps = opts?.reinstall || !(await isInstalled(id, signature));

        const steps: [RunPhase, string, string][] = [
          ['installing-runtime', `Setting up ${plugin.name}`, plan.installRuntime],
          ...(needDeps ? [['installing-deps', 'Installing dependencies', plan.installDeps] as [RunPhase, string, string]] : []),
        ];

        for (const [phase, title, script] of steps) {
          if (l.cancelled) return;
          patchRun(id, { phase });
          log(`\n▶ ${title}\n`);
          const stepId = newSessionId(`${id}-step`);
          l.session = stepId; // so Stop can reach it
          const code = await runToEnd({ id: stepId, label: project.name, script, cwd: project.dir, env: plan.env, onOutput: log });
          l.session = null;
          if (l.cancelled) return; // Stop was pressed during this step
          if (code !== 0) {
            log(`\n✖ ${title} failed (exit ${code})\n`);
            patchRun(id, { phase: 'failed' });
            return;
          }
        }
        if (needDeps) await markInstalled(id, signature);
        if (l.cancelled) return;

        const sessionId = newSessionId(id);
        l.session = sessionId;
        patchRun(id, { phase: 'starting', sessionId });
        log(`\n▶ Starting ${plugin.name} on port ${project.port}\n`);
        await startProcess({
          id: sessionId,
          label: project.name,
          script: plan.start,
          cwd: project.dir,
          env: plan.env,
          onOutput: log,
          onExit: (code) => {
            log(`\n■ Process exited (code ${code})\n`);
            if (liveFor(id).session === sessionId) liveFor(id).session = null;
            // Ignore exits from an older run that finished after a new one began.
            patchRun(id, (r) =>
              r.sessionId !== sessionId
                ? {}
                : { phase: r.phase === 'stopped' || code === 0 ? 'stopped' : 'failed', sessionId: null, port: null },
            );
          },
        });
        watchPort(id, sessionId, project.port);
      } catch (e: any) {
        l.session = null;
        log(`\n✖ ${String(e?.message ?? e)}\n`);
        patchRun(id, { phase: 'failed', sessionId: null });
      }
    },
    [detect, patchRun, appendLog, watchPort, resetLog],
  );

  const stop = useCallback(
    async (project: Project) => {
      const l = liveFor(project.id);
      l.cancelled = true;
      const sid = l.session;
      l.session = null;
      patchRun(project.id, { phase: 'stopped', port: null, sessionId: null });
      if (sid) await stopProcess(sid);
    },
    [patchRun],
  );

  const removeProject = useCallback(
    async (id: string) => {
      const p = projectsRef.current.find((x) => x.id === id);
      if (!p) return;
      await stop(p);
      await deleteProject(p);
      await forgetInstalled(id);
      await persist(projectsRef.current.filter((x) => x.id !== id));
      setRuns(({ [id]: _gone, ...rest }) => rest);
    },
    [persist, stop],
  );

  const clearLogs = useCallback(
    (project: Project) => {
      resetLog(project.id);
      patchRun(project.id, { logs: '' });
    },
    [patchRun, resetLog],
  );

  const value = useMemo<Ctx>(
    () => ({
      envStatus, envError, setup, startSetup,
      projects, addProject, removeProject,
      github, signIn, signOut,
      runs, detect, setPlugin, run, stop, clearLogs,
    }),
    [
      envStatus, envError, setup, startSetup, projects, addProject, removeProject,
      github, signIn, signOut, runs, detect, setPlugin, run, stop, clearLogs,
    ],
  );

  return <RunnerCtx.Provider value={value}>{children}</RunnerCtx.Provider>;
}

export function useRunner() {
  const ctx = useContext(RunnerCtx);
  if (!ctx) throw new Error('useRunner must be used inside <RunnerProvider>');
  return ctx;
}

export const runStateFor = (runs: Record<string, RunState>, id: string) => runs[id] ?? EMPTY_RUN;
