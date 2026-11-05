import { Body, Controller, Delete, Get, HttpCode, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { DownloaderService, type DownloadRequest } from './downloader.service';

type Uploaded = { originalname: string; buffer: Buffer; size: number };

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

  /** Status cookies.txt (tidak pernah mengembalikan isi cookie). */
  @Get('cookies')
  cookies() {
    return this.downloader.cookiesStatus();
  }

  /** Upload cookies.txt format Netscape untuk Bilibili/YouTube yang butuh login. */
  @Post('cookies')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1_000_000 } }))
  uploadCookies(@UploadedFile() file: Uploaded) {
    return this.downloader.saveCookies(file?.buffer ?? Buffer.alloc(0));
  }

  @Delete('cookies')
  clearCookies() {
    return this.downloader.clearCookies();
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
