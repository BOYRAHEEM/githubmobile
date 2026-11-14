/**
 * Spots the "server is ready" line in dev-server output and pulls out the URL.
 * Covers Next.js, Vite, CRA, Express logs, Django, Flask, uvicorn, http.server…
 */
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/i;
const PORT_RE = /(?:listening|running|started|serving|ready)[^\n]*?(?:port|:)\s*(\d{2,5})/i;

/** Strips terminal colour codes so the patterns match. */
export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');

export function findPort(text: string): number | null {
  const clean = stripAnsi(text);
  const m = clean.match(URL_RE) ?? clean.match(PORT_RE);
  if (!m) return null;
  const port = Number(m[1]);
  return port > 0 && port < 65536 ? port : null;
}

/**
 * True if something answers HTTP on this port. Used when a server never prints
 * its URL: any response (even a 404) means it's up.
 */
export async function probePort(port: number, timeoutMs = 1500): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(`http://127.0.0.1:${port}/`, { method: 'GET', signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
