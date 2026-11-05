import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DownloaderService, type DownloadRequest } from './downloader.service';

@Controller('downloader')
export class DownloaderController {
  constructor(private readonly downloader: DownloaderService) {}

  /** Metadata dulu: judul, thumbnail, durasi, resolusi yang tersedia. */
  @Post('info')
  @HttpCode(200)
  async info(@Body() body: DownloadRequest, @Res({ passthrough: true }) res: Response): Promise<unknown> {
    const abort = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) abort.abort();
    };
    res.once('close', onClose);
    try {
      return await this.downloader.info(body ?? {}, abort.signal);
    } finally {
      res.removeListener('close', onClose);
    }
  }

  /** Streaming langsung ke respons (dipakai frontend via fetch + File System Access). */
  @Post('proxy')
  @HttpCode(200)
  async proxy(@Body() body: DownloadRequest, @Res() res: Response) {
    await this.run(body ?? {}, res);
  }

  /** Alternatif browser: tautan GET langsung (Content-Disposition memicu Save As). */
  @Get('proxy')
  async proxyGet(
    @Query('url') url: string | undefined,
    @Query('quality') quality: string | undefined,
    @Query('audio') audio: string | undefined,
    @Res() res: Response,
  ) {
    await this.run({ url, quality, audioOnly: audio === '1' || audio === 'true' }, res);
  }

  private async run(input: DownloadRequest, res: Response): Promise<void> {
    const abort = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) abort.abort();
    };
    res.once('close', onClose);

    try {
      const prepared = await this.downloader.prepare(input, abort.signal);
      if (abort.signal.aborted) {
        await prepared.cleanup();
        return;
      }
      await this.downloader.send(prepared, res);
    } catch (error) {
      // Setelah header terkirim, satu-satunya respons yang benar adalah menutup
      // stream; error sebelum itu dibiarkan ditangani exception filter Nest.
      if (!res.headersSent && !abort.signal.aborted) throw error;
      if (!res.writableEnded) res.end();
    } finally {
      res.removeListener('close', onClose);
    }
  }
}
