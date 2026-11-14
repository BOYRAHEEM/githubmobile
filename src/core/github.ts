import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

/**
 * GitHub sign-in for private repos.
 *
 * Two ways in:
 *  1. Device flow – "Sign in with GitHub": the app shows a short code, the user
 *     enters it on github.com/login/device. Needs a GitHub OAuth App client ID
 *     in app.json → expo.extra.githubClientId (with Device Flow enabled).
 *  2. Personal access token – pasted by the user. Always available.
 *
 * The token lives in the Android Keystore via expo-secure-store.
 */

const TOKEN_KEY = 'github-token';
const API = 'https://api.github.com';

export type GitHubUser = { login: string; name: string | null; avatar_url: string };
export type GitHubRepo = {
  id: number;
  full_name: string;
  private: boolean;
  description: string | null;
  language: string | null;
  updated_at: string;
  clone_url: string;
};

export const githubClientId = (): string | null =>
  (Constants.expoConfig?.extra?.githubClientId as string | undefined) || null;

// ------------------------------------------------------------------ storage

export const loadToken = () => SecureStore.getItemAsync(TOKEN_KEY);
export const saveToken = (t: string) => SecureStore.setItemAsync(TOKEN_KEY, t);
export const clearToken = () => SecureStore.deleteItemAsync(TOKEN_KEY);

// ---------------------------------------------------------------------- API

async function api<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (res.status === 401) throw new Error('GitHub rejected the token. Sign in again.');
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
  return res.json();
}

/** Checks a token and returns who it belongs to. */
export const fetchUser = (token: string) => api<GitHubUser>('/user', token);

/** Repos the user owns or can access, most recently updated first (up to 500). */
export async function fetchRepos(token: string): Promise<GitHubRepo[]> {
  const all: GitHubRepo[] = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await api<GitHubRepo[]>(
      `/user/repos?sort=updated&per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`,
      token,
    );
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

// -------------------------------------------------------------- device flow

export type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
};

export async function startDeviceFlow(clientId: string): Promise<DeviceCode> {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: 'repo read:user' }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error_description ?? 'Could not start GitHub sign-in');
  return data;
}

/**
 * Polls until the user approves the code. Resolves with the token, or rejects
 * if they deny it, it expires, or [signal] is aborted.
 */
export async function pollDeviceFlow(clientId: string, code: DeviceCode, signal: { aborted: boolean }): Promise<string> {
  let interval = code.interval * 1000;
  const deadline = Date.now() + code.expires_in * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    if (signal.aborted) throw new Error('Cancelled');

    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        device_code: code.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const data = await res.json();

    if (data.access_token) return data.access_token;
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') {
      interval += 5000; // GitHub asks us to back off
      continue;
    }
    if (data.error === 'access_denied') throw new Error('Sign-in was cancelled on GitHub');
    if (data.error === 'expired_token') break;
    throw new Error(data.error_description ?? data.error ?? 'GitHub sign-in failed');
  }
  throw new Error('The code expired. Try again.');
}
