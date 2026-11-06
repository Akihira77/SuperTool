import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { openAsBlob } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Input, Telegraf, type Context } from 'telegraf';
import { cfg } from '../../config';
import { CompressService, type CompressResult } from '../tools/compress.service';
import { DownloaderService, isAllowedHost } from '../downloader/downloader.service';

const MAX_TELEGRAM_SEND = 45 * 1024 * 1024;
// Bot API membatasi getFile untuk bot biasa ke 20 MB.
const MAX_TELEGRAM_DOWNLOAD = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
const TELEGRAM_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const UPLOAD_TIMEOUT_MS = 30 * 60_000;
const COMPRESS_TIMEOUT_MS = 15 * 60_000;

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.pdf': 'application/pdf',
};

const HELP = [
  '🤖 Super Tool Command Center',
  '',
  '📥 Download',
  'Kirim link YouTube, Facebook, atau Bilibili. Bot akan mengunduh video 720p dan mengirimkannya ke chat ini.',
  'File ≤45 MB dikirim langsung. File lebih besar diunggah ke 0x0.st, lalu link download dikirim.',
  '',
  '🗜️ Kompres',
  'Kirim gambar atau PDF dengan caption /compress. Bot mengunduh file dari Telegram, mengompresnya, lalu mengirim hasilnya kembali.',
  '',
  'ℹ️ Perintah',
  '/start — tampilkan bantuan ini',
  '/help — bantuan',
  '/id — lihat chat ID (untuk allowlist)',
  '',
  'Catatan: link 0x0.st bersifat publik dan sementara. Jangan kirim file sensitif.',
].join('\n');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(value: number): string {
  if (value < 1024) return value + ' B';
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return size.toFixed(size >= 10 ? 0 : 1) + ' ' + units[index];
}

function errorMessage(error: unknown): string {
  if (error instanceof BadRequestException) {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object' && 'message' in response) {
      const message = (response as { message?: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join(', ');
    }
  }
  if (error instanceof Error) return error.message;
  return String(error ?? 'Terjadi kesalahan.');
}

function mimeFor(name: string, fallback?: string): string {
  if (fallback && (fallback.startsWith('image/') || fallback === 'application/pdf')) return fallback;
  return MIME_BY_EXT[extname(name).toLowerCase()] ?? fallback ?? 'application/octet-stream';
}

function safeExtension(name: string, mime: string): string {
  const ext = extname(name).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  const fromMime = Object.entries(MIME_BY_EXT).find(([, value]) => value === mime)?.[0];
  return fromMime ?? '.bin';
}

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private readonly allowed = new Set(cfg.telegram.allowedChatIds);
  private readonly busy = new Set<number>();
  private bot: Telegraf | null = null;

  constructor(
    private readonly downloader: DownloaderService,
    private readonly compress: CompressService,
  ) {}

  async onModuleInit(): Promise<void> {
    const token = cfg.telegram.botToken;
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN kosong; Telegram Command Center nonaktif.');
      return;
    }

    if (!this.allowed.size) {
      this.logger.warn('TELEGRAM_ALLOWED_CHAT_IDS kosong; bot menerima chat dari siapa saja.');
    }

    const bot = new Telegraf(token);
    this.bot = bot;
    this.register(bot);
    bot.catch((error, ctx) => {
      this.logger.error('Telegram update gagal: ' + errorMessage(error).slice(0, 500));
      if (ctx.chat) void ctx.reply('❌ Terjadi kesalahan internal.').catch(() => undefined);
    });

    try {
      const me = await bot.telegram.getMe();
      this.logger.log('Telegram bot @' + me.username + ' aktif (long polling).');
      void bot.telegram
        .setMyCommands([
          { command: 'start', description: 'Bantuan dan cara pakai' },
          { command: 'id', description: 'Lihat chat ID' },
          { command: 'compress', description: 'Cara kompres gambar/PDF' },
        ])
        .catch(() => undefined);
      void bot.launch({ dropPendingUpdates: false }).catch((error) => {
        this.logger.error('Long polling Telegram berhenti: ' + errorMessage(error).slice(0, 500));
      });
    } catch (error) {
      this.bot = null;
      this.logger.error('Gagal memulai Telegram bot: ' + errorMessage(error).slice(0, 500));
    }
  }

  onModuleDestroy(): void {
    this.bot?.stop('SIGTERM');
    this.bot = null;
  }

  private register(bot: Telegraf): void {
    bot.use(async (ctx, next) => {
      if (this.allowed.size) {
        const chatId = ctx.chat?.id;
        const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
        const publicCommand = /^\/(?:start|help|id)(?:@\w+)?(?:\s|$)/i.test(text);
        if (chatId === undefined || (!this.allowed.has(String(chatId)) && !publicCommand)) {
          await ctx.reply('Chat ini belum diizinkan. Kirim /id untuk melihat chat ID, lalu tambahkan ke TELEGRAM_ALLOWED_CHAT_IDS.');
          return;
        }
      }
      return next();
    });

    bot.start((ctx) => ctx.reply(HELP));
    bot.help((ctx) => ctx.reply(HELP));
    bot.command('id', (ctx) => ctx.reply('Chat ID: ' + String(ctx.chat?.id ?? '-')));
    bot.command('compress', (ctx) =>
      ctx.reply('Kirim gambar atau PDF dengan caption /compress.'),
    );

    bot.on('text', (ctx) => this.handleText(ctx));
    bot.on('document', (ctx) => this.handleDocument(ctx));
    bot.on('photo', (ctx) => this.handlePhoto(ctx));
  }

  private async handleText(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (!message || !('text' in message)) return;
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Gunakan bot ini di chat pribadi.');
      return;
    }

    let text = message.text.trim();
    if (/^\/download(?:@\w+)?(?:\s|$)/i.test(text)) {
      text = text.replace(/^\/download(?:@\w+)?/i, '').trim();
    } else if (text.startsWith('/')) {
      await ctx.reply('Perintah tidak dikenal. Kirim /start untuk bantuan.');
      return;
    }

    const rawUrl = text.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.!?]+$/, '');
    if (!rawUrl) {
      await ctx.reply('Kirim link YouTube, Facebook, atau Bilibili. Ketik /start untuk bantuan.');
      return;
    }

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      await ctx.reply('Link tidak valid.');
      return;
    }
    if (!isAllowedHost(url.hostname)) {
      await ctx.reply('Hanya link YouTube, Facebook, dan Bilibili yang didukung.');
      return;
    }

    await this.runExclusive(chatId, () => this.downloadVideo(ctx, url.toString()));
  }

  private async downloadVideo(ctx: Context, url: string): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const status = await ctx.reply('⏳ Sedang mengunduh video (720p)...');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const prepared = await this.downloader.prepare({ url, quality: '720' }, controller.signal);
      try {
        await this.deliverFile(
          ctx,
          prepared.filePath,
          prepared.filename,
          prepared.contentType,
          prepared.size,
          'Video selesai diunduh.',
          status.message_id,
        );
      } finally {
        await prepared.cleanup();
      }
      await this.deleteStatus(ctx, status.message_id);
    } catch (error) {
      await this.editStatus(ctx, status.message_id, '❌ ' + errorMessage(error).slice(0, 1200));
    } finally {
      clearTimeout(timer);
    }
  }

  private async handleDocument(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (!message || !('document' in message) || !message.document) return;
    if (!this.isCompressCaption(message.caption)) return;
    const document = message.document;
    const mime = document.mime_type || mimeFor(document.file_name ?? '');
    if (!mime.startsWith('image/') && mime !== 'application/pdf') {
      await ctx.reply('Hanya gambar dan PDF yang bisa dikompres.');
      return;
    }
    const ext = safeExtension(document.file_name ?? '', mime);
    await this.processCompressFile(
      ctx,
      document.file_id,
      document.file_size,
      mime,
      'telegram-' + Date.now() + ext,
    );
  }

  private async handlePhoto(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (!message || !('photo' in message) || !message.photo.length) return;
    if (!this.isCompressCaption(message.caption)) return;
    const photo = message.photo[message.photo.length - 1];
    await this.processCompressFile(ctx, photo.file_id, photo.file_size, 'image/jpeg', 'telegram-' + Date.now() + '.jpg');
  }

  private isCompressCaption(caption?: string): boolean {
    return /^\/compress(?:@\w+)?(?:\s|$)/i.test((caption ?? '').trim());
  }

  private async processCompressFile(
    ctx: Context,
    fileId: string,
    fileSize: number | undefined,
    mime: string,
    suggestedName: string,
  ): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Gunakan bot ini di chat pribadi.');
      return;
    }
    if (fileSize && fileSize > MAX_TELEGRAM_DOWNLOAD) {
      await ctx.reply('File terlalu besar untuk diunduh bot Telegram (maksimal 20 MB).');
      return;
    }

    await this.runExclusive(chatId, async () => {
      const status = await ctx.reply('🗜️ Mengunduh file dari Telegram...');
      let dir = '';
      try {
        await mkdir(cfg.tempDir, { recursive: true });
        dir = await mkdtemp(join(cfg.tempDir, 'telegram-'));
        const source = await this.downloadTelegramFile(fileId, mime, suggestedName, dir);
        await this.editStatus(ctx, status.message_id, '🗜️ Mengompres...');
        const result = await this.runCompressor(source.path, mime);
        await this.editStatus(ctx, status.message_id, '📤 Mengirim hasil...');
        const outMime = mimeFor(result.output.path, mime);
        const caption =
          '🗜️ ' + basename(result.output.path) + '\n' +
          formatBytes(result.input.size) + ' → ' + formatBytes(result.output.size) +
          ' (' + String(result.percent) + '%)';
        await this.deliverFile(
          ctx,
          result.output.path,
          basename(result.output.path),
          outMime,
          result.output.size,
          caption,
          status.message_id,
        );
        await this.deleteStatus(ctx, status.message_id);
      } catch (error) {
        await this.editStatus(ctx, status.message_id, '❌ ' + errorMessage(error).slice(0, 1200));
      } finally {
        if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  }

  private async downloadTelegramFile(
    fileId: string,
    mime: string,
    suggestedName: string,
    dir: string,
  ): Promise<{ path: string; mime: string }> {
    const link = await this.telegramFileLink(fileId);
    const response = await fetch(link, { signal: AbortSignal.timeout(TELEGRAM_DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) throw new Error('Gagal mengunduh file dari Telegram (' + response.status + ').');
    const size = Number(response.headers.get('content-length'));
    if (Number.isFinite(size) && size > MAX_TELEGRAM_DOWNLOAD) {
      throw new BadRequestException('File terlalu besar (maksimal 20 MB).');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_TELEGRAM_DOWNLOAD) throw new BadRequestException('File terlalu besar (maksimal 20 MB).');
    const ext = safeExtension(suggestedName, mime);
    const path = join(dir, 'input' + ext);
    await writeFile(path, bytes);
    return { path, mime };
  }

  // Helper dibuat method agar link tidak tersimpan di log/error.
  private async telegramFileLink(fileId: string): Promise<URL> {
    const bot = this.bot;
    if (!bot) throw new Error('Bot Telegram tidak aktif.');
    return bot.telegram.getFileLink(fileId);
  }

  private async runCompressor(path: string, mime: string): Promise<CompressResult> {
    const isPdf = mime === 'application/pdf' || extname(path).toLowerCase() === '.pdf';
    const { jobId } = isPdf ? await this.compress.pdf(path, {}) : await this.compress.image(path, {});
    const started = Date.now();
    for (;;) {
      const job = this.compress.job(jobId);
      if (job.state === 'done' && job.result) return job.result;
      if (job.state === 'error') throw new Error(job.error || 'Kompresi gagal.');
      if (Date.now() - started > COMPRESS_TIMEOUT_MS) throw new Error('Kompresi terlalu lama (timeout).');
      await sleep(500);
    }
  }

  private async deliverFile(
    ctx: Context,
    path: string,
    filename: string,
    contentType: string,
    size: number,
    caption: string,
    statusMessageId?: number,
  ): Promise<void> {
    if (size > MAX_TELEGRAM_SEND) {
      if (statusMessageId !== undefined) {
        await this.editStatus(ctx, statusMessageId, '☁️ Mengunggah ke 0x0.st...');
      }
      const link = await this.uploadTo0x0(path, filename);
      await ctx.reply(
        'File ' + formatBytes(size) + ' melebihi batas Telegram (45 MB).\n' +
          'Link download sementara: ' + link + '\n\n' +
          'Link ini publik dan akan kedaluwarsa.',
        { link_preview_options: { is_disabled: false } },
      );
      return;
    }

    if (statusMessageId !== undefined) {
      await this.editStatus(ctx, statusMessageId, '📤 Mengirim file...');
    }
    const file = Input.fromLocalFile(path, filename);
    try {
      if (contentType === 'video/mp4' || contentType === 'video/quicktime') {
        await ctx.replyWithVideo(file, { caption, supports_streaming: true });
      } else {
        await ctx.replyWithDocument(file, { caption });
      }
    } catch (error) {
      // Video yang tidak didukung Telegram tetap dikirim sebagai dokumen.
      if (contentType.startsWith('video/')) {
        await ctx.replyWithDocument(Input.fromLocalFile(path, filename), { caption });
      } else {
        throw error;
      }
    }
  }

  private async uploadTo0x0(path: string, filename: string): Promise<string> {
    const blob = await openAsBlob(path);
    const form = new FormData();
    form.append('file', blob, filename);
    const response = await fetch('https://0x0.st', {
      method: 'POST',
      body: form,
      headers: { 'User-Agent': 'super-tool-telegram/1.0' },
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    const body = (await response.text()).trim();
    if (!response.ok) {
      throw new Error(
        '0x0.st menolak unggahan (' + response.status + '): ' + body.slice(0, 180),
      );
    }
    const link = body
      .split(/\s+/)
      .map((part) => part.trim())
      .find((part) => {
        try {
          const url = new URL(part);
          return url.protocol === 'https:' && url.hostname === '0x0.st';
        } catch {
          return false;
        }
      });
    if (!link) throw new Error('0x0.st tidak mengembalikan link download.');
    return link;
  }

  private async runExclusive(chatId: number, task: () => Promise<void>): Promise<void> {
    if (this.busy.has(chatId)) {
      await this.replyBusy(chatId);
      return;
    }
    this.busy.add(chatId);
    try {
      await task();
    } finally {
      this.busy.delete(chatId);
    }
  }

  private async replyBusy(chatId: number): Promise<void> {
    try {
      const bot = this.bot;
      if (bot) await bot.telegram.sendMessage(chatId, '⏳ Masih ada proses lain. Tunggu sampai selesai.');
    } catch {
      // Abaikan bila chat sudah tidak tersedia.
    }
  }

  private async editStatus(ctx: Context, messageId: number, text: string): Promise<void> {
    if (!ctx.chat) return;
    try {
      await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, text);
    } catch {
      // Status lama tidak selalu bisa diedit (pesan dihapus/terlalu lama).
    }
  }

  private async deleteStatus(ctx: Context, messageId: number): Promise<void> {
    if (!ctx.chat) return;
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, messageId);
    } catch {
      // Abaikan.
    }
  }
}
