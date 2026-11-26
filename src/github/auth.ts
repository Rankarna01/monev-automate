import { Octokit } from '@octokit/rest';
import type { AppConfig } from '../config.js';
import type { ReportRepo, UserRecord } from '../db/repo.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';

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

function getEncryptionSecret(config: AppConfig): string {
  return config.ENCRYPTION_KEY || config.TELEGRAM_BOT_TOKEN;
}

/**
 * Mengambil token & username GitHub milik user tertentu (didekripsi dari tabel `users`).
 */
export function getUserGitHubCredentials(
  config: AppConfig,
  user: UserRecord,
): GitHubCredentials | null {
  if (!user.github_token_enc) {
    return null;
  }

  const token = decryptSecret(user.github_token_enc, getEncryptionSecret(config));
  if (!token) {
    return null;
  }

  return {
    token,
    username: user.github_username ?? '',
  };
}

/**
 * Menyimpan token (terenkripsi) & username GitHub milik user ke tabel `users`.
 */
export async function saveUserGitHubCredentials(
  config: AppConfig,
  repo: ReportRepo,
  userId: number,
  token: string,
  username: string,
): Promise<UserRecord> {
  const tokenEnc = encryptSecret(token, getEncryptionSecret(config));
  return repo.updateUserGitHub(userId, { tokenEnc, username });
}

/**
 * Menghapus kredensial GitHub milik user dari tabel `users`.
 */
export async function clearUserGitHubCredentials(
  repo: ReportRepo,
  userId: number,
): Promise<UserRecord> {
  return repo.updateUserGitHub(userId, { tokenEnc: null, username: null });
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
 * Menambah atau menghapus satu repo dari whitelist milik user (toggle).
 */
export async function toggleUserWhitelistedRepo(
  repo: ReportRepo,
  user: UserRecord,
  fullName: string,
): Promise<{ repos: string[]; added: boolean }> {
  const current = Array.isArray(user.whitelisted_repos)
    ? user.whitelisted_repos
    : [];
  const exists = current.includes(fullName);
  const next = exists
    ? current.filter((item) => item !== fullName)
    : [...current, fullName];

  const updated = await repo.updateUserRepos(user.id, next);
  return { repos: updated.whitelisted_repos, added: !exists };
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
