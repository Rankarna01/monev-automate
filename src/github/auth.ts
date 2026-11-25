import { Octokit } from '@octokit/rest';
import type { AppConfig } from '../config.js';
import type { ReportRepo } from '../db/repo.js';

const SETTING_GITHUB_TOKEN = 'github_token';
const SETTING_GITHUB_USERNAME = 'github_username';
const SETTING_GITHUB_REPOS = 'github_repos';

export interface GitHubCredentials {
  token: string;
  username: string;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/**
 * Mengambil token & username GitHub dari MySQL (prioritas) atau fallback ke .env.
 */
export async function getGitHubCredentials(
  config: AppConfig,
  repo: ReportRepo,
): Promise<GitHubCredentials | null> {
  const dbToken = await repo.getSetting(SETTING_GITHUB_TOKEN);
  const dbUsername = await repo.getSetting(SETTING_GITHUB_USERNAME);

  const token = dbToken || config.GITHUB_TOKEN;
  const username = dbUsername || config.GITHUB_USERNAME;

  if (!token) {
    return null;
  }

  return { token, username };
}

/**
 * Menyimpan token & username GitHub secara dinamis ke MySQL.
 */
export async function saveGitHubCredentials(
  repo: ReportRepo,
  token: string,
  username: string,
): Promise<void> {
  await repo.setSetting(SETTING_GITHUB_TOKEN, token);
  await repo.setSetting(SETTING_GITHUB_USERNAME, username);
}

/**
 * Menghapus kredensial GitHub yang tersimpan di MySQL.
 */
export async function clearGitHubCredentials(repo: ReportRepo): Promise<void> {
  await repo.setSetting(SETTING_GITHUB_TOKEN, '');
  await repo.setSetting(SETTING_GITHUB_USERNAME, '');
}

/**
 * Memvalidasi token GitHub dan mengembalikan info akun terautentikasi.
 */
export async function validateGitHubToken(
  token: string,
): Promise<{ login: string; name: string | null }> {
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.users.getAuthenticated();
  return { login: data.login, name: data.name ?? null };
}

/**
 * Mengambil daftar repo whitelist dari MySQL (fallback ke GITHUB_REPOS di .env).
 */
export async function getWhitelistedRepos(
  config: AppConfig,
  repo: ReportRepo,
): Promise<string[]> {
  const raw = await repo.getSetting(SETTING_GITHUB_REPOS);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        return parsed;
      }
    } catch {
      // Abaikan jika format JSON korup, fallback ke .env
    }
  }
  return [...config.GITHUB_REPOS];
}

/**
 * Menyimpan daftar repo whitelist ke MySQL.
 */
export async function saveWhitelistedRepos(
  repo: ReportRepo,
  repos: string[],
): Promise<string[]> {
  const normalized = Array.from(new Set(repos.map((r) => r.trim()).filter(Boolean)));
  await repo.setSetting(SETTING_GITHUB_REPOS, JSON.stringify(normalized));
  return normalized;
}

/**
 * Menambah atau menghapus satu repo dari whitelist (toggle).
 */
export async function toggleWhitelistedRepo(
  config: AppConfig,
  repo: ReportRepo,
  fullName: string,
): Promise<{ repos: string[]; added: boolean }> {
  const current = await getWhitelistedRepos(config, repo);
  const exists = current.includes(fullName);
  const next = exists
    ? current.filter((item) => item !== fullName)
    : [...current, fullName];

  const saved = await saveWhitelistedRepos(repo, next);
  return { repos: saved, added: !exists };
}

/**
 * Memulai GitHub OAuth Device Flow agar user bisa login di browser (termasuk via Google).
 */
export async function requestDeviceCode(
  clientId: string,
): Promise<DeviceCodeResponse> {
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: 'repo read:user',
    }),
  });

  if (!response.ok) {
    throw new Error(`Gagal memulai GitHub Device Flow (HTTP ${response.status})`);
  }

  const data = (await response.json()) as Partial<DeviceCodeResponse> & {
    error_description?: string;
  };
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error(data.error_description ?? 'Respons GitHub Device Flow tidak lengkap');
  }

  return {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    expires_in: data.expires_in ?? 900,
    interval: data.interval ?? 5,
  };
}

/**
 * Melakukan polling token OAuth sampai user menyetujui di browser atau waktu habis.
 */
export async function pollDeviceAccessToken(
  clientId: string,
  deviceCode: string,
  intervalSeconds: number,
  expiresInSeconds: number,
): Promise<string> {
  let intervalMs = Math.max(intervalSeconds, 5) * 1000;
  const deadline = Date.now() + expiresInSeconds * 1000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    const data = (await response.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (data.access_token) {
      return data.access_token;
    }

    if (data.error === 'authorization_pending') {
      continue;
    }
    if (data.error === 'slow_down') {
      intervalMs += 5000;
      continue;
    }
    if (data.error === 'expired_token') {
      throw new Error('Kode login GitHub sudah kedaluwarsa. Silakan ulangi /github login.');
    }
    if (data.error === 'access_denied') {
      throw new Error('Login GitHub dibatalkan oleh pengguna.');
    }
    if (data.error) {
      throw new Error(data.error_description ?? data.error);
    }
  }

  throw new Error('Waktu login GitHub habis.');
}
