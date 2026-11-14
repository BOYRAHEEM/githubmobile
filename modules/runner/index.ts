import { NativeModule, requireNativeModule } from 'expo-modules-core';

/** Events the native side sends to JavaScript. */
export type RunnerEvents = {
  onOutput: (e: { id: string; stream: 'stdout' | 'stderr'; chunk: string }) => void;
  onExit: (e: { id: string; code: number }) => void;
  onBootstrapProgress: (e: { phase: string; done: number; total: number; message: string }) => void;
};

export type RunnerInfo = {
  rootfs: string;
  nativeLibDir: string;
  hasProot: boolean;
  rootfsReady: boolean;
  abi: string;
};

export type DirEntry = { name: string; isDir: boolean; size: number };

declare class RunnerModuleType extends NativeModule<RunnerEvents> {
  getInfo(): RunnerInfo;
  /** sha256: expected hex digest of the archive, checked when given. */
  installRootfs(url: string, sha256: string | null): Promise<void>;

  /** Runs a bash script once. `label` appears in the "running" notification. */
  start(id: string, label: string, script: string, cwd: string, env: Record<string, string>): Promise<void>;
  /** Interactive login shell on a real PTY. */
  startTerminal(id: string, cwd: string, env: Record<string, string>, rows: number, cols: number): Promise<void>;
  resize(id: string, rows: number, cols: number): Promise<void>;
  write(id: string, data: string): Promise<void>;
  stop(id: string): Promise<void>;
  isRunning(id: string): boolean;
  /** Stops every process (used on start-up: JS can't reattach after a reload). */
  stopAll(): Promise<void>;

  /** All paths are guest paths, as seen from inside Linux. */
  readText(path: string): Promise<string | null>;
  writeText(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<DirEntry[]>;
  remove(path: string): Promise<boolean>;

  /** Android 13+: asks to show the "running" notification. Resolves true if already allowed. */
  requestNotificationPermission(): Promise<boolean>;
}

export const Runner = requireNativeModule<RunnerModuleType>('Runner');
