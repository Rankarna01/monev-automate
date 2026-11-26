import { InlineKeyboard, type Bot } from 'grammy';
import {
  clearGeminiApiKey,
  getGeminiCredentials,
  saveGeminiApiKey,
  saveGeminiModel,
  validateGeminiApiKey,
} from '../ai/config.js';
import { summarizeManualNotesWithGemini } from '../ai/summarize.js';
import type { AppConfig } from '../config.js';
import type { ReportRepo } from '../db/repo.js';
import {
  clearUserGitHubCredentials,
  pollDeviceAccessToken,
  requestDeviceCode,
  saveUserGitHubCredentials,
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
  handleManualNotesPromptAction,
  handleMediaModePromptAction,
  handleRepoListAction,
  handleRiwayatAction,
  handleStatusAction,
  handleTesAction,
  handleTutorialAction,
  processMediaToDraft,
  resolveCurrentUser,
  type BotActionDeps,
} from './actions.js';
import {
  buildDraftKeyboard,
  buildDraftMessage,
  buildGreetingMenuKeyboard,
  buildGreetingMessage,
  buildOnboardingStartMessage,
  CALLBACK_ACTIONS,
} from './messages.js';

/**
 * Mendaftarkan perintah slash bot Telegram dan handler pesan teks multi-user.
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
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;

    const today = getTodayWibDate();
    const quota = await repo.getAiQuotaStatus(
      user.id,
      today,
      config.AI_DAILY_LIMIT,
    );

    logger.info(
      { chatId: user.telegram_chat_id, userId: user.id },
      'Perintah /start diterima',
    );

    await ctx.reply(
      buildOnboardingStartMessage(
        user,
        quota,
        formatScheduleDays(user.schedule_days),
      ),
      {
        parse_mode: 'Markdown',
        reply_markup: buildGreetingMenuKeyboard(),
      },
    );
  });

  bot.command('status', async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;
    await handleStatusAction(ctx, deps, user);
  });

  bot.command('tutorial', async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;
    await handleTutorialAction(ctx, user);
  });

  bot.command('jam', async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;

    const arg = ctx.match.trim();
    if (!arg) {
      await ctx.reply(
        `🕒 Jam pengingat saat ini: *${user.schedule_time} WIB*\nGunakan \`/jam 15:00\` atau klik *🕒 Ubah Jam & Jadwal* di menu.`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    try {
      const parsed = parseScheduleTime(arg);
      const updated = await repo.updateUserSchedule(user.id, {
        time: parsed.formatted,
      });
      await ctx.reply(
        `✅ Jam pengingat harian diubah menjadi *${updated.schedule_time} WIB* (${formatScheduleDays(updated.schedule_days)}).`,
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await ctx.reply(`❌ ${msg}`);
    }
  });

  bot.command('hari', async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;

    const arg = ctx.match.trim();
    if (!arg) {
      await ctx.reply(
        `📅 Hari aktif saat ini: *${formatScheduleDays(user.schedule_days)}*\nContoh ubah: \`/hari senin-jumat\` atau \`/hari senin,rabu,jumat\``,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    try {
      const days = parseScheduleDays(arg);
      const updated = await repo.updateUserSchedule(user.id, { days });
      await ctx.reply(
        `✅ Hari aktif pengingat diubah menjadi *${formatScheduleDays(updated.schedule_days)}* (pukul *${updated.schedule_time} WIB*).`,
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await ctx.reply(`❌ ${msg}`);
    }
  });

  bot.command('github', async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;

    const raw = ctx.match.trim();
    const [sub, ...rest] = raw.split(/\s+/);
    const arg = rest.join(' ').trim();

    if (!sub || sub === 'status') {
      await handleGitHubStatusAction(ctx, deps, user);
      return;
    }

    if (sub === 'login') {
      if (!config.GITHUB_CLIENT_ID) {
        await ctx.reply(
          [
            '⚠️ `GITHUB_CLIENT_ID` belum diatur oleh admin.',
            'Alternatif cepat: buat Fine-grained PAT (Read-only `Contents` & `Metadata`) di GitHub lalu kirim `/github token <PAT_KAMU>`.',
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
            '2. Login ke akun GitHub pribadimu (bisa lewat *Continue with Google*)',
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
            const ghUser = await validateGitHubToken(accessToken);
            await saveUserGitHubCredentials(
              config,
              repo,
              user.id,
              accessToken,
              ghUser.login,
            );
            logger.info(
              { userId: user.id, username: ghUser.login },
              'GitHub OAuth Device Flow berhasil',
            );
            await bot.api.sendMessage(
              user.telegram_chat_id,
              `✅ *GitHub berhasil terhubung sebagai \`${ghUser.login}\`!*\n\nSekarang kirim \`/repo\` untuk memilih repository lewat tombol.`,
              { parse_mode: 'Markdown' },
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn({ err: msg, userId: user.id }, 'GitHub OAuth Device Flow gagal');
            await bot.api.sendMessage(
              user.telegram_chat_id,
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
        const ghUser = await validateGitHubToken(arg);
        await saveUserGitHubCredentials(config, repo, user.id, arg, ghUser.login);
        logger.info(
          { userId: user.id, username: ghUser.login },
          'GitHub PAT user tersimpan',
        );
        await ctx.reply(
          `✅ *GitHub terhubung sebagai \`${ghUser.login}\`!*\nKirim \`/repo\` untuk memilih repository lewat tombol.`,
          { parse_mode: 'Markdown' },
        );
      } catch {
        await ctx.reply('❌ Token GitHub tidak valid atau gagal diverifikasi.');
      }
      return;
    }

    if (sub === 'logout') {
      await clearUserGitHubCredentials(repo, user.id);
      await ctx.reply('✅ Kredensial GitHub di akunmu telah dihapus.');
      return;
    }

    await ctx.reply(
      'Sub-perintah tidak dikenal. Gunakan `/github`, `/github login`, `/github token <PAT>`, atau `/github logout`.',
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('repo', async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;

    const raw = ctx.match.trim();
    const [sub, target] = raw.split(/\s+/);

    if (sub === 'tambah' && target) {
      try {
        const parsed = parseRepoFullName(target);
        const fullName = `${parsed.owner}/${parsed.repo}`;
        const updated = await repo.updateUserRepos(user.id, [
          ...user.whitelisted_repos,
          fullName,
        ]);
        await ctx.reply(
          `✅ \`${fullName}\` ditambahkan ke whitelist (total: ${updated.whitelisted_repos.length} repo).`,
          { parse_mode: 'Markdown' },
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await ctx.reply(`❌ ${msg}`);
      }
      return;
    }

    if (sub === 'hapus' && target) {
      const next = user.whitelisted_repos.filter((item) => item !== target.trim());
      const updated = await repo.updateUserRepos(user.id, next);
      await ctx.reply(
        `🗑️ \`${target.trim()}\` dihapus dari whitelist (sisa: ${updated.whitelisted_repos.length} repo).`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    await handleRepoListAction(ctx, deps, user);
  });

  bot.command('gemini', async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;

    const raw = ctx.match.trim();
    const [sub, ...rest] = raw.split(/\s+/);
    const arg = rest.join(' ').trim();

    if (!sub || sub === 'status') {
      await handleGeminiStatusAction(ctx, deps, user);
      return;
    }

    // Pengaturan API Key global hanya boleh diubah oleh admin (TELEGRAM_CHAT_ID di .env)
    if (user.telegram_chat_id !== config.TELEGRAM_CHAT_ID) {
      await ctx.reply(
        'ℹ️ Layanan Gemini AI menggunakan kuota global. Gunakan `/gemini` untuk melihat sisa kuota harianmu.',
        { parse_mode: 'Markdown' },
      );
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
        await ctx.reply('⏳ Memverifikasi Gemini API Key global...');
        await validateGeminiApiKey(arg, model);
        await saveGeminiApiKey(repo, arg);
        await ctx.reply(
          `✅ *Gemini API Key global valid dan tersimpan!*\nModel aktif: \`${model}\``,
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
      await ctx.reply(`✅ Model Gemini global diubah menjadi \`${arg}\`.`, {
        parse_mode: 'Markdown',
      });
      return;
    }

    if (sub === 'hapus') {
      await clearGeminiApiKey(repo);
      await ctx.reply('✅ API key Gemini global dinamis telah dihapus.');
      return;
    }

    await ctx.reply(
      'Sub-perintah tidak dikenal. Gunakan `/gemini`, `/gemini key <API_KEY>`, `/gemini model <MODEL>`, atau `/gemini hapus`.',
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('catatan', async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;
    await handleManualNotesPromptAction(ctx, deps, user);
  });

  bot.command('riwayat', async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;
    await handleRiwayatAction(ctx, deps, user);
  });

  bot.command('tes', async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;
    await handleTesAction(ctx, deps, user);
  });

  // Handler pesan teks biasa: Mode Catatan AI, Mode Edit Draf, atau Sapaan Menu
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;

    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;

    const today = getTodayWibDate();
    const report = await repo.getTodayReport(user.id, today);

    // 1. Mode Catatan AI (Tanpa GitHub): kembangkan poin singkat menjadi 3 kolom Monev
    if (report?.status === 'menunggu_catatan') {
      const gemini = await getGeminiCredentials(config, repo);
      if (!gemini) {
        await ctx.reply('❌ Layanan Gemini AI global belum diatur oleh admin.');
        return;
      }

      try {
        const preQuota = await repo.getAiQuotaStatus(
          user.id,
          today,
          config.AI_DAILY_LIMIT,
        );
        if (preQuota.remaining <= 0) {
          await ctx.reply(
            `⚠️ *Kuota AI harian kamu (${preQuota.used}/${preQuota.limit}) sudah habis.*\nKuota akan reset otomatis besok pukul 00:00 WIB.`,
            { parse_mode: 'Markdown' },
          );
          return;
        }

        await repo.updateStatus(user.id, today, 'mengambil_data', {
          manualNotes: text,
          sourceMode: 'manual_ai',
        });

        await ctx.reply('🔄 *Mengembangkan catatan kegiatanmu dengan Gemini AI...*', {
          parse_mode: 'Markdown',
        });

        const draft = await summarizeManualNotesWithGemini({
          apiKey: gemini.apiKey,
          model: gemini.model,
          date: today,
          manualNotes: text,
        });

        const quota = await repo.consumeAiQuota(
          user.id,
          today,
          config.AI_DAILY_LIMIT,
        );

        const sent = await ctx.reply(buildDraftMessage(today, draft, quota), {
          parse_mode: 'Markdown',
          reply_markup: buildDraftKeyboard(),
        });

        await repo.saveDraft(user.id, today, {
          sourceMode: 'manual_ai',
          manualNotes: text,
          ...draft,
          telegramMessageId: sent.message_id,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ err: msg, userId: user.id, today }, 'Gagal mengembangkan catatan AI');
        try {
          await repo.updateStatus(user.id, today, 'gagal', { error: msg });
        } catch {
          // Abaikan jika transisi tidak valid
        }
        await ctx.reply(`❌ ${msg}`);
      }
      return;
    }

    // 2. Mode Edit Draf (tidak mengurangi kuota AI)
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

      const quota = await repo.getAiQuotaStatus(
        user.id,
        today,
        config.AI_DAILY_LIMIT,
      );
      const sent = await ctx.reply(
        buildDraftMessage(today, validation.data, quota),
        {
          parse_mode: 'Markdown',
          reply_markup: buildDraftKeyboard(),
        },
      );

      await repo.saveDraft(user.id, today, {
        ...validation.data,
        telegramMessageId: sent.message_id,
      });
      return;
    }

    // 3. Sapaan / teks umum: tampilkan menu cepat & sisa kuota
    const quota = await repo.getAiQuotaStatus(
      user.id,
      today,
      config.AI_DAILY_LIMIT,
    );
    await ctx.reply(
      buildGreetingMessage(
        user,
        quota,
        formatScheduleDays(user.schedule_days),
      ),
      {
        parse_mode: 'Markdown',
        reply_markup: buildGreetingMenuKeyboard(),
      },
    );
  });

  // Handler Foto: wajib memilih metode Foto dulu agar sistem akurat
  bot.on('message:photo', async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;

    const today = getTodayWibDate();
    const report = await repo.getTodayReport(user.id, today);

    if (report?.status !== 'menunggu_foto') {
      await ctx.reply(
        '📷 Pilih metode *📷 Dari Foto* terlebih dahulu agar sistem memproses foto ini sebagai laporan harian:',
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text(
            '📷 Aktifkan Mode Foto',
            CALLBACK_ACTIONS.PHOTO_AI,
          ),
        },
      );
      return;
    }

    const photos = ctx.message.photo;
    const bestPhoto = photos[photos.length - 1];
    if (!bestPhoto) return;

    try {
      await processMediaToDraft(ctx, deps, user, 'photo_ai', {
        fileId: bestPhoto.file_id,
        mimeType: 'image/jpeg',
        caption: ctx.message.caption,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ err: msg, userId: user.id, today }, 'Gagal memproses foto');
      try {
        await repo.updateStatus(user.id, today, 'gagal', { error: msg });
      } catch {
        // Abaikan jika transisi tidak valid
      }
      await ctx.reply(`❌ Gagal memproses foto: ${msg}`);
    }
  });

  // Handler Voice Note & Audio: wajib memilih metode Voice dulu
  bot.on(['message:voice', 'message:audio'], async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;

    const today = getTodayWibDate();
    const report = await repo.getTodayReport(user.id, today);

    if (report?.status !== 'menunggu_voice') {
      await ctx.reply(
        '🎤 Pilih metode *🎤 Dari Voice* terlebih dahulu agar sistem memproses rekaman suara ini sebagai laporan harian:',
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text(
            '🎤 Aktifkan Mode Voice',
            CALLBACK_ACTIONS.VOICE_AI,
          ),
        },
      );
      return;
    }

    const voiceOrAudio = ctx.message.voice ?? ctx.message.audio;
    if (!voiceOrAudio) return;

    try {
      await processMediaToDraft(ctx, deps, user, 'voice_ai', {
        fileId: voiceOrAudio.file_id,
        mimeType: voiceOrAudio.mime_type ?? 'audio/ogg',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ err: msg, userId: user.id, today }, 'Gagal memproses voice');
      try {
        await repo.updateStatus(user.id, today, 'gagal', { error: msg });
      } catch {
        // Abaikan jika transisi tidak valid
      }
      await ctx.reply(`❌ Gagal memproses voice note: ${msg}`);
    }
  });

  bot.command('foto', async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (user) await handleMediaModePromptAction(ctx, deps, user, 'photo_ai');
  });

  bot.command('voice', async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (user) await handleMediaModePromptAction(ctx, deps, user, 'voice_ai');
  });
}
