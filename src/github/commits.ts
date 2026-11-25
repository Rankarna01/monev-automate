import { Octokit } from '@octokit/rest';

export interface AccessibleRepo {
  fullName: string;
  isPrivate: boolean;
}

export interface CommitSummaryItem {
  repo: string;
  sha: string;
  message: string;
  committedAt: string;
  files: string[];
}

export interface FetchCommitsResult {
  commits: CommitSummaryItem[];
  perRepoCount: Record<string, number>;
}

/**
 * Menghitung rentang waktu ISO satu hari penuh dalam zona WIB (GMT+7).
 */
export function getWibDayRange(dateStr: string): { since: string; until: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Format tanggal tidak valid: "${dateStr}"`);
  }
  return {
    since: `${dateStr}T00:00:00+07:00`,
    until: `${dateStr}T23:59:59+07:00`,
  };
}

/**
 * Mem-parsing repo format "owner/name".
 */
export function parseRepoFullName(fullName: string): { owner: string; repo: string } {
  const parts = fullName.trim().split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Format repo tidak valid: "${fullName}". Gunakan format owner/nama`);
  }
  return { owner: parts[0], repo: parts[1] };
}

/**
 * Mengambil daftar repository yang dapat diakses oleh token GitHub pengguna.
 */
export async function listAccessibleRepos(token: string): Promise<AccessibleRepo[]> {
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.repos.listForAuthenticatedUser({
    sort: 'updated',
    direction: 'desc',
    per_page: 100,
    affiliation: 'owner,collaborator,organization_member',
  });

  return data.map((item) => ({
    fullName: item.full_name,
    isPrivate: item.private,
  }));
}

/**
 * Mengurutkan daftar commit lintas repo secara kronologis (terlama ke terbaru).
 */
export function sortCommitsChronologically(
  commits: CommitSummaryItem[],
): CommitSummaryItem[] {
  return [...commits].sort(
    (a, b) => new Date(a.committedAt).getTime() - new Date(b.committedAt).getTime(),
  );
}

function mapGitHubError(error: unknown, repoFullName?: string): Error {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: number }).status;
    if (status === 401) {
      return new Error('Token GitHub tidak valid atau sudah kedaluwarsa. Login ulang via /github.');
    }
    if (status === 403 || status === 429) {
      return new Error('Akses GitHub ditolak atau terkena rate limit. Coba lagi beberapa saat.');
    }
    if (status === 404 && repoFullName) {
      return new Error(`Repo "${repoFullName}" tidak ditemukan atau tidak punya izin akses.`);
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Mengambil commit hari ini (WIB) dari seluruh repo whitelist,
 * memfilter author, dan hanya mengambil pesan commit + daftar nama file (tanpa diff).
 */
export async function fetchTodayCommits(options: {
  token: string;
  username: string;
  repos: string[];
  date: string;
}): Promise<FetchCommitsResult> {
  if (options.repos.length === 0) {
    throw new Error('Daftar repo whitelist masih kosong. Pilih repo dulu lewat /repo.');
  }

  const octokit = new Octokit({ auth: options.token });
  const { since, until } = getWibDayRange(options.date);
  const allCommits: CommitSummaryItem[] = [];
  const perRepoCount: Record<string, number> = {};

  for (const fullName of options.repos) {
    const { owner, repo } = parseRepoFullName(fullName);
    try {
      const { data: commitList } = await octokit.repos.listCommits({
        owner,
        repo,
        since,
        until,
        ...(options.username ? { author: options.username } : {}),
        per_page: 100,
      });

      perRepoCount[fullName] = commitList.length;

      for (const item of commitList) {
        const { data: detail } = await octokit.repos.getCommit({
          owner,
          repo,
          ref: item.sha,
        });

        const committedAt =
          item.commit.author?.date ??
          item.commit.committer?.date ??
          new Date().toISOString();

        allCommits.push({
          repo: fullName,
          sha: item.sha.slice(0, 7),
          message: item.commit.message.trim(),
          committedAt,
          files: (detail.files ?? []).map((f) => f.filename),
        });
      }
    } catch (error) {
      throw mapGitHubError(error, fullName);
    }
  }

  return {
    commits: sortCommitsChronologically(allCommits),
    perRepoCount,
  };
}
