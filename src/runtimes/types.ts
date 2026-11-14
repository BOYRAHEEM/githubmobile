/**
 * A runtime plugin teaches the app how to run one kind of project.
 *
 * To add a new language: create a file in this folder that exports a
 * RuntimePlugin, then add it to the list in registry.ts. Nothing else changes.
 */

/** What a plugin can look at when deciding whether a repo is "theirs". */
export type RepoContext = {
  /** Guest path of the repo, e.g. /root/projects/my-app */
  dir: string;
  /** File and folder names at the repo root. */
  files: string[];
  has(name: string): boolean;
  /** Reads a text file relative to the repo root (null if missing). */
  read(name: string): Promise<string | null>;
  /** Parsed package.json, if there is one. */
  packageJson: PackageJson | null;
};

export type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  packageManager?: string;
};

/** A plugin's verdict on a repo. */
export type Detection = {
  pluginId: string;
  /** 0-100. The highest score wins. */
  confidence: number;
  /** Human-readable label, e.g. "Next.js · pnpm · Node 20" */
  label: string;
  /** Why this was picked, shown in the UI. */
  reason: string;
  /** Free-form data the plugin passes to its own install/start steps. */
  meta: Record<string, string>;
};

export type RunPlan = {
  /** Installs the language/tool itself. Must be safe to run again. */
  installRuntime: string;
  /** Installs the repo's own dependencies. */
  installDeps: string;
  /** Starts the app. */
  start: string;
  /** Extra environment variables for all three steps. */
  env: Record<string, string>;
};

export type RuntimePlugin = {
  id: string;
  name: string;
  detect(ctx: RepoContext): Promise<Detection | null>;
  plan(det: Detection, ctx: { port: number }): RunPlan;
};
