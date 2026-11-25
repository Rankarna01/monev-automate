import type { Bot } from 'grammy';
import {
  clearGeminiApiKey,
  getGeminiCredentials,
  saveGeminiApiKey,
  saveGeminiModel,
  validateGeminiApiKey,
} from '../ai/config.js';
import type { AppConfig } from '../config.js';
import type { ReportRepo } from '../db/repo.js';
import {
  clearGitHubCredentials,
  getWhitelistedRepos,
  pollDeviceAccessToken,
  requestDeviceCode,
  saveGitHubCredentials,
  saveWhitelistedRepos,
  validateGitHubToken,
} from '../github/auth.js';
import { parseRepoFullName } from '../github/commits.js';
import type { SchedulerService } from '../scheduler/cron.js';
import {
  formatScheduleDays,
  parseScheduleDays,
  parseScheduleTime,
} from '../scheduler/scheduleParser.js';
import type { Logger } from '../utils/logger.js';
import { getTodayWibDate } from '../utils/time.js';
import { parseDraftEditText, validateDraft } from '../utils/validate.js';
import {
  handleGeminiStatusAction,
  handleGitHubStatusAction,
  handleRepoListAction,
  handleRiwayatAction,
  handleStatusAction,
  handleTesAction,
  type BotActionDeps,
} from './actions.js';
import {
  buildDraftKeyboard,
  buildDraftMessage,
  buildGreetingMenuKeyboard,
  buildGreetingMessage,
  buildStartMessage,
} from './messages.js';

const GREETING_REGEX = /^(halo+|hallo+|hai+|hi+|pagi|siang|sore|malam|menu|help|p)$/i;

/**
 * Mendaftarkan perintah slash bot Telegram dan handler pesan teks (sapaan & edit draf).
 */
export function registerCommands(
  bot: Bot,
  config: AppConfig,
  logger: Logger,
  repo: ReportRepo,
  getScheduler: () => SchedulerService,
): void {
  const deps: BotActionDeps = { config, logger, repo, getScheduler };

  bot.command('start', async (ctx) => {
    logger.info({ chatId: ctx.chat.id }, 'Perintah /start diterima');
    const schedule = getScheduler().getCurrentSchedule();
    await ctx.reply(
      buildStartMessage(schedule.time, formatScheduleDays(schedule.days)),
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('status', async (ctx) => {
    logger.info({ chatId: ctx.chat.id }, 'Perintah /status diterima');
    await handleStatusAction(ctx, deps);
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
      await handleGitHubStatusAction(ctx, deps);
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

    await handleRepoListAction(ctx, deps);
  });

  bot.command('gemini', async (ctx) => {
    const raw = ctx.match.trim();
    const [sub, ...rest] = raw.split(/\s+/);
    const arg = rest.join(' ').trim();

    if (!sub || sub === 'status') {
      await handleGeminiStatusAction(ctx, deps);
      return;
    }

    if (sub === 'key' || sub === 'set') {
      if (!arg) {
        await ctx.reply('Gunakan: `/gemini key <GEMINI_API_KEY>`', {
          parse_mode: 'Markdown',
        });
        return;
      }

      const current = await getGeminiCredentials(config, repo);
      const model = current?.model ?? config.GEMINI_MODEL;

      try {
        await ctx.reply('⏳ Memverifikasi Gemini API Key...');
        await validateGeminiApiKey(arg, model);
        await saveGeminiApiKey(repo, arg);
        logger.info({ model }, 'GEMINI_API_KEY tersimpan via /gemini key');
        await ctx.reply(
          `✅ *Gemini API Key valid dan tersimpan!*\nModel aktif: \`${model}\``,
          { parse_mode: 'Markdown' },
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await ctx.reply(`❌ Gagal memverifikasi Gemini API Key: ${msg}`);
      }
      return;
    }

    if (sub === 'model') {
      if (!arg) {
        await ctx.reply('Gunakan: `/gemini model gemini-3.8-flash`', {
          parse_mode: 'Markdown',
        });
        return;
      }
      await saveGeminiModel(repo, arg);
      await ctx.reply(`✅ Model Gemini diubah menjadi \`${arg}\`.`, {
        parse_mode: 'Markdown',
      });
      return;
    }

    if (sub === 'hapus') {
      await clearGeminiApiKey(repo);
      await ctx.reply('✅ API key Gemini dinamis di database telah dihapus.');
      return;
    }

    await ctx.reply(
      'Sub-perintah tidak dikenal. Gunakan `/gemini`, `/gemini key <API_KEY>`, `/gemini model <MODEL>`, atau `/gemini hapus`.',
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('riwayat', async (ctx) => {
    logger.info({ chatId: ctx.chat.id }, 'Perintah /riwayat diterima');
    await handleRiwayatAction(ctx, deps);
  });

  bot.command('tes', async (ctx) => {
    logger.info({ chatId: ctx.chat.id }, 'Perintah /tes diterima');
    await handleTesAction(ctx, deps);
  });

  // Handler pesan teks biasa: alur Edit draf & sapaan ("halo", "menu", dll)
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;

    const today = getTodayWibDate();
    const report = await repo.getTodayReport(today);

    if (report?.status === 'menunggu_edit') {
      const existingDraft = {
        aktivitas: report.aktivitas ?? '',
        pembelajaran: report.pembelajaran ?? '',
        kendala: report.kendala ?? '',
      };

      const { parsed, matchedAnyHeader } = parseDraftEditText(text, existingDraft);
      if (!matchedAnyHeader) {
        await ctx.reply(
          '⚠️ Format revisi tidak dikenali. Awali dengan `Aktivitas:`, `Pembelajaran:`, atau `Kendala:` (boleh salah satu saja).',
          { parse_mode: 'Markdown' },
        );
        return;
      }

      const validation = validateDraft(parsed);
      if (!validation.success) {
        await ctx.reply(
          [
            '❌ *Revisi belum memenuhi syarat (minimal 100 karakter per field):*',
            ...validation.errors.map((e) => `• ${e}`),
            '',
            'Silakan kirim ulang teks revisinya.',
          ].join('\n'),
          { parse_mode: 'Markdown' },
        );
        return;
      }

      const sent = await ctx.reply(buildDraftMessage(today, validation.data), {
        parse_mode: 'Markdown',
        reply_markup: buildDraftKeyboard(),
      });

      await repo.saveDraft(today, {
        ...validation.data,
        telegramMessageId: sent.message_id,
      });
      return;
    }

    if (GREETING_REGEX.test(text)) {
      const schedule = getScheduler().getCurrentSchedule();
      await ctx.reply(
        buildGreetingMessage(schedule.time, formatScheduleDays(schedule.days)),
        {
          parse_mode: 'Markdown',
          reply_markup: buildGreetingMenuKeyboard(),
        },
      );
      return;
    }

    // Untuk pesan teks lain yang tidak dikenal, tampilkan menu cepat
    const schedule = getScheduler().getCurrentSchedule();
    await ctx.reply(
      buildGreetingMessage(schedule.time, formatScheduleDays(schedule.days)),
      {
        parse_mode: 'Markdown',
        reply_markup: buildGreetingMenuKeyboard(),
      },
    );
  });
}
