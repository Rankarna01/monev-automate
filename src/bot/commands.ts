import type { Bot } from 'grammy';
import type { AppConfig } from '../config.js';
import type { ReportRepo } from '../db/repo.js';
import { formatStatusLabel } from '../db/stateMachine.js';
import {
  clearGitHubCredentials,
  getGitHubCredentials,
  getWhitelistedRepos,
  pollDeviceAccessToken,
  requestDeviceCode,
  saveGitHubCredentials,
  saveWhitelistedRepos,
  validateGitHubToken,
} from '../github/auth.js';
import { listAccessibleRepos, parseRepoFullName } from '../github/commits.js';
import type { SchedulerService } from '../scheduler/cron.js';
import {
  formatScheduleDays,
  parseScheduleDays,
  parseScheduleTime,
} from '../scheduler/scheduleParser.js';
import type { Logger } from '../utils/logger.js';
import { getTodayWibDate } from '../utils/time.js';
import {
  buildReminderKeyboard,
  buildReminderMessage,
  buildStartMessage,
} from './messages.js';
import { buildRepoSelectionKeyboard, setCachedRepos } from './repoKeyboard.js';

/**
 * Mendaftarkan perintah slash bot Telegram.
 */
export function registerCommands(
  bot: Bot,
  config: AppConfig,
  logger: Logger,
  repo: ReportRepo,
  getScheduler: () => SchedulerService,
): void {
  bot.command('start', async (ctx) => {
    logger.info({ chatId: ctx.chat.id }, 'Perintah /start diterima');
    const schedule = getScheduler().getCurrentSchedule();
    await ctx.reply(
      buildStartMessage(schedule.time, formatScheduleDays(schedule.days)),
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('status', async (ctx) => {
    const today = getTodayWibDate();
    logger.info({ chatId: ctx.chat.id, today }, 'Perintah /status diterima');

    const report = await repo.getTodayReport(today);
    const schedule = getScheduler().getCurrentSchedule();
    const creds = await getGitHubCredentials(config, repo);
    const whitelist = await getWhitelistedRepos(config, repo);
    const statusText = report
      ? formatStatusLabel(report.status)
      : 'Belum ada aktivitas hari ini';

    const lines = [
      '📊 *Status Bot & Laporan*',
      `• Tanggal (WIB): \`${today}\``,
      `• Status laporan: *${statusText}*`,
      `• Jadwal: *${schedule.time} WIB* (${formatScheduleDays(schedule.days)})`,
      `• GitHub: ${creds ? `✅ Terhubung (\`${creds.username || 'token aktif'}\`)` : '❌ Belum terhubung (`/github`)'}`,
      `• Repo whitelist: *${whitelist.length} repo*`,
      `• Mode Dry Run Monev: \`${config.DRY_RUN ? 'aktif' : 'nonaktif'}\``,
    ];

    if (report?.error) {
      lines.push(`• Error terakhir: \`${report.error}\``);
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  });

  bot.command('jam', async (ctx) => {
    const arg = ctx.match.trim();
    const scheduler = getScheduler();

    if (!arg) {
      const current = scheduler.getCurrentSchedule();
      await ctx.reply(
        `🕒 Jam pengingat saat ini: *${current.time} WIB*\nGunakan \`/jam 14:30\` untuk mengubah.`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    try {
      const parsed = parseScheduleTime(arg);
      const updated = await scheduler.reloadSchedule(parsed.formatted, undefined);
      logger.info({ time: updated.time }, 'Jadwal jam diperbarui via /jam');
      await ctx.reply(
        `✅ Jam pengingat harian diubah menjadi *${updated.time} WIB* (${formatScheduleDays(updated.days)}).`,
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await ctx.reply(`❌ ${msg}`);
    }
  });

  bot.command('hari', async (ctx) => {
    const arg = ctx.match.trim();
    const scheduler = getScheduler();

    if (!arg) {
      const current = scheduler.getCurrentSchedule();
      await ctx.reply(
        `📅 Hari aktif saat ini: *${formatScheduleDays(current.days)}*\nContoh ubah: \`/hari senin-jumat\` atau \`/hari senin,rabu,jumat\``,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    try {
      const days = parseScheduleDays(arg);
      const updated = await scheduler.reloadSchedule(undefined, days);
      logger.info({ days: updated.days }, 'Hari aktif diperbarui via /hari');
      await ctx.reply(
        `✅ Hari aktif pengingat diubah menjadi *${formatScheduleDays(updated.days)}* (pukul *${updated.time} WIB*).`,
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await ctx.reply(`❌ ${msg}`);
    }
  });

  bot.command('github', async (ctx) => {
    const raw = ctx.match.trim();
    const [sub, ...rest] = raw.split(/\s+/);
    const arg = rest.join(' ').trim();

    if (!sub || sub === 'status') {
      const creds = await getGitHubCredentials(config, repo);
      if (creds) {
        try {
          const info = await validateGitHubToken(creds.token);
          await ctx.reply(
            [
              '🐙 *Status Akun GitHub*',
              `• Status: ✅ *Terhubung*`,
              `• Username: \`${info.login}\`${info.name ? ` (${info.name})` : ''}`,
              '',
              'Gunakan `/repo` untuk memilih repository whitelist.',
              'Gunakan `/github logout` untuk memutus koneksi.',
            ].join('\n'),
            { parse_mode: 'Markdown' },
          );
          return;
        } catch {
          await ctx.reply(
            '⚠️ Token GitHub tersimpan tapi sudah tidak valid. Hubungkan ulang via `/github login` atau `/github token <PAT>`.',
            { parse_mode: 'Markdown' },
          );
          return;
        }
      }

      await ctx.reply(
        [
          '🐙 *Akun GitHub belum terhubung*',
          '',
          'Cara menghubungkan:',
          '1. *Login via Browser (OAuth Device Flow — bisa pakai akun Google GitHub):*',
          '   Kirim `/github login` (butuh `GITHUB_CLIENT_ID` di `.env`)',
          '2. *Pakai Fine-grained PAT (langsung tanpa OAuth App):*',
          '   Kirim `/github token <PAT_KAMU>`',
        ].join('\n'),
        { parse_mode: 'Markdown' },
      );
      return;
    }

    if (sub === 'login') {
      if (!config.GITHUB_CLIENT_ID) {
        await ctx.reply(
          [
            '⚠️ `GITHUB_CLIENT_ID` belum diisi di `.env`.',
            'Untuk login via browser (termasuk akun Google GitHub), buat OAuth App di GitHub Developer Settings, centang *Enable Device Flow*, lalu isi `GITHUB_CLIENT_ID` di `.env`.',
            '',
            'Alternatif cepat: kirim `/github token <PAT_KAMU>`.',
          ].join('\n'),
          { parse_mode: 'Markdown' },
        );
        return;
      }

      try {
        const device = await requestDeviceCode(config.GITHUB_CLIENT_ID);
        await ctx.reply(
          [
            '🔐 *Login GitHub via Browser*',
            `1. Buka link: ${device.verification_uri}`,
            `2. Login ke GitHub (bisa lewat *Continue with Google*)`,
            `3. Masukkan kode: \`${device.user_code}\``,
            '',
            '⏳ Menunggu konfirmasi dari browser...',
          ].join('\n'),
          { parse_mode: 'Markdown' },
        );

        void (async () => {
          try {
            const accessToken = await pollDeviceAccessToken(
              config.GITHUB_CLIENT_ID,
              device.device_code,
              device.interval,
              device.expires_in,
            );
            const user = await validateGitHubToken(accessToken);
            await saveGitHubCredentials(repo, accessToken, user.login);
            logger.info({ username: user.login }, 'GitHub OAuth Device Flow berhasil');
            await bot.api.sendMessage(
              config.TELEGRAM_CHAT_ID,
              `✅ *GitHub berhasil terhubung sebagai \`${user.login}\`!*\n\nSekarang kirim \`/repo\` untuk memilih repository lewat tombol.`,
              { parse_mode: 'Markdown' },
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn({ err: msg }, 'GitHub OAuth Device Flow gagal');
            await bot.api.sendMessage(
              config.TELEGRAM_CHAT_ID,
              `❌ Login GitHub gagal: ${msg}`,
            );
          }
        })();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await ctx.reply(`❌ ${msg}`);
      }
      return;
    }

    if (sub === 'token') {
      if (!arg) {
        await ctx.reply('Gunakan: `/github token <GITHUB_PAT>`', {
          parse_mode: 'Markdown',
        });
        return;
      }

      try {
        const user = await validateGitHubToken(arg);
        await saveGitHubCredentials(repo, arg, user.login);
        logger.info({ username: user.login }, 'GitHub PAT tersimpan via /github token');
        await ctx.reply(
          `✅ *GitHub terhubung sebagai \`${user.login}\`!*\nKirim \`/repo\` untuk memilih repository lewat tombol.`,
          { parse_mode: 'Markdown' },
        );
      } catch {
        await ctx.reply('❌ Token GitHub tidak valid atau gagal diverifikasi.');
      }
      return;
    }

    if (sub === 'logout') {
      await clearGitHubCredentials(repo);
      await ctx.reply('✅ Kredensial GitHub dinamis di database telah dihapus.');
      return;
    }

    await ctx.reply(
      'Sub-perintah tidak dikenal. Gunakan `/github`, `/github login`, `/github token <PAT>`, atau `/github logout`.',
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('repo', async (ctx) => {
    const raw = ctx.match.trim();
    const [sub, target] = raw.split(/\s+/);

    if (sub === 'tambah' && target) {
      try {
        const parsed = parseRepoFullName(target);
        const fullName = `${parsed.owner}/${parsed.repo}`;
        const current = await getWhitelistedRepos(config, repo);
        const saved = await saveWhitelistedRepos(repo, [...current, fullName]);
        await ctx.reply(
          `✅ \`${fullName}\` ditambahkan ke whitelist (total: ${saved.length} repo).`,
          { parse_mode: 'Markdown' },
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await ctx.reply(`❌ ${msg}`);
      }
      return;
    }

    if (sub === 'hapus' && target) {
      const current = await getWhitelistedRepos(config, repo);
      const next = current.filter((item) => item !== target.trim());
      const saved = await saveWhitelistedRepos(repo, next);
      await ctx.reply(
        `🗑️ \`${target.trim()}\` dihapus dari whitelist (sisa: ${saved.length} repo).`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const creds = await getGitHubCredentials(config, repo);
    if (!creds) {
      await ctx.reply(
        '❌ Akun GitHub belum terhubung. Kirim `/github` terlebih dahulu.',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    try {
      const accessible = await listAccessibleRepos(creds.token);
      if (accessible.length === 0) {
        await ctx.reply('ℹ️ Tidak ada repository yang dapat diakses oleh token GitHub ini.');
        return;
      }

      setCachedRepos(accessible);
      const whitelisted = await getWhitelistedRepos(config, repo);
      const { keyboard, totalPages, currentPage } = buildRepoSelectionKeyboard(
        accessible,
        whitelisted,
        0,
      );

      await ctx.reply(
        `📚 *Pilih Repository Whitelist* (Halaman ${currentPage + 1}/${totalPages})\nAktif saat ini: *${whitelisted.length} repo*\n\nKlik tombol untuk mengaktifkan/menonaktifkan:`,
        {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await ctx.reply(`❌ Gagal mengambil daftar repo GitHub: ${msg}`);
    }
  });

  bot.command('riwayat', async (ctx) => {
    logger.info({ chatId: ctx.chat.id }, 'Perintah /riwayat diterima');
    const reports = await repo.getRecentReports(7);

    if (reports.length === 0) {
      await ctx.reply('🗂️ Belum ada riwayat laporan tersimpan di database.');
      return;
    }

    const rows = reports.map(
      (r) => `• \`${r.date}\` — ${formatStatusLabel(r.status)}`,
    );

    await ctx.reply(['🗂️ *7 Laporan Terakhir*', '', ...rows].join('\n'), {
      parse_mode: 'Markdown',
    });
  });

  bot.command('tes', async (ctx) => {
    const today = getTodayWibDate();
    logger.info({ chatId: ctx.chat.id, today }, 'Perintah /tes diterima');

    const existing = await repo.getTodayReport(today);
    if (
      existing &&
      (existing.status === 'terkirim' ||
        existing.status === 'dilewati' ||
        existing.status === 'kedaluwarsa')
    ) {
      await ctx.reply(
        `ℹ️ Laporan tanggal \`${today}\` sudah berstatus *${formatStatusLabel(existing.status)}*.`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const sent = await ctx.reply(buildReminderMessage(today), {
      parse_mode: 'Markdown',
      reply_markup: buildReminderKeyboard(),
    });

    await repo.createOrGetTodayReport(today, sent.message_id);
  });
}
