import { Runner } from '../../modules/runner';
import { q, STEP_PRELUDE } from '../runtimes/shell';
import { runToEnd } from './sessions';

/** A cloned repo. Saved as JSON inside the Linux environment. */
export type Project = {
  id: string;
  name: string;
  repoUrl: string;
  /** Guest path, e.g. /root/projects/my-app */
  dir: string;
  /** Plugin chosen by detection, or by the user. */
  pluginId?: string;
  /** Port given to this project's dev server. */
  port: number;
  createdAt: number;
};

const STORE = '/root/.repo-runner/projects.json';
const PROJECTS_DIR = '/root/projects';
const FIRST_PORT = 3100;

export async function loadProjects(): Promise<Project[]> {
  const raw = await Runner.readText(STORE).catch(() => null);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveProjects(projects: Project[]) {
  await Runner.writeText(STORE, JSON.stringify(projects, null, 2));
}

/**
 * Accepts "owner/repo", "github.com/owner/repo", browser links (…/tree/main,
 * …/blob/x), SSH links (git@github.com:owner/repo) and other https git URLs.
 * Returns an https clone URL and a safe folder name.
 */
export function normaliseRepoUrl(input: string): { url: string; name: string } {
  let s = input.trim().replace(/\/+$/, '');

  if (/^[\w.-]+\/[\w.-]+$/.test(s)) s = `https://github.com/${s}`; // owner/repo
  s = s.replace(/^(www\.)?github\.com\//i, 'https://github.com/'); // no scheme
  // SSH needs keys we don't have; GitHub serves the same repo over https.
  s = s.replace(/^git@github\.com:/i, 'https://github.com/').replace(/^ssh:\/\/git@github\.com\//i, 'https://github.com/');
  s = s.replace(/^http:\/\//i, 'https://');

  if (!/^https:\/\/[^/\s]+\/\S+$/.test(s)) {
    throw new Error('Paste a GitHub link like github.com/owner/repo');
  }
  if (/^https:\/\/(www\.)?github\.com\//i.test(s)) {
    // Keep only owner/repo so links copied from the browser still work.
    const [owner, repo] = s.replace(/^https:\/\/(www\.)?github\.com\//i, '').split(/[/?#]/);
    if (!owner || !repo || /^\.+$/.test(repo)) throw new Error('That GitHub link is missing the repo name');
    s = `https://github.com/${owner}/${repo.replace(/\.git$/, '')}`;
  }

  const raw = s.split(/[/?#]/).filter(Boolean).pop() ?? '';
  // Folder names: letters, digits, . _ - only, and never "." or "..".
  const name = raw.replace(/\.git$/, '').replace(/[^\w.-]/g, '-').replace(/^\.+/, '') || 'repo';
  return { url: s.endsWith('.git') ? s : `${s}.git`, name };
}

/** Clones a repo into /root/projects and returns the new project. */
export async function cloneProject(
  input: string,
  existing: Project[],
  onOutput: (chunk: string) => void,
): Promise<Project> {
  const { url, name } = normaliseRepoUrl(input);

  // Unique folder name, also avoiding leftovers on disk from a failed delete.
  const onDisk = new Set((await Runner.listDir(PROJECTS_DIR).catch(() => [])).map((e) => e.name));
  const taken = (f: string) => onDisk.has(f) || existing.some((p) => p.dir === `${PROJECTS_DIR}/${f}`);
  let folder = name;
  for (let i = 2; taken(folder); i++) folder = `${name}-${i}`;
  const dir = `${PROJECTS_DIR}/${folder}`;

  const code = await runToEnd({
    label: `Cloning ${name}`,
    script: `${STEP_PRELUDE}mkdir -p ${PROJECTS_DIR}\ngit clone --depth 1 --progress ${q(url)} ${q(dir)}`,
    cwd: '/root',
    withGitAuth: true,
    onOutput,
  });
  if (code !== 0) throw new Error('git clone failed. Check the link, and sign in to GitHub for private repos.');

  const usedPorts = new Set(existing.map((p) => p.port));
  let port = FIRST_PORT;
  while (usedPorts.has(port)) port++;

  return { id: folder, name: folder, repoUrl: url, dir, port, createdAt: Date.now() };
}

export async function deleteProject(p: Project) {
  await Runner.remove(p.dir);
}
