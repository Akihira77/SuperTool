import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { jailPath } from '../../common/fs-jail';
import { FilesService } from './files.service';
import { mimeOf } from './mime';

type Uploaded = { originalname: string; buffer: Buffer };

/** "*.log, *.map" -> ['*.log', '*.map'] */
function parseInclude(raw?: string): string[] {
  return String(raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function parseExclude(raw?: string): string[] {
  return String(raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length < 64)
    .slice(0, 20);
}

@Controller('fs')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get('roots')
  roots() {
    return this.files.roots();
  }

  @Get('list')
  list(@Query('path') path: string) {
    return this.files.list(path);
  }

  @Get('read')
  read(@Query('path') path: string) {
    return this.files.readText(path);
  }

  @Get('office')
  office(@Query('path') path: string) {
    return this.files.office(path);
  }

  @Post('office')
  saveOffice(
    @Body() body: { path: string; texts?: string[]; cells?: Array<{ sheet: number; ref: string; value: string }> },
  ) {
    return this.files.saveOffice(body?.path, body ?? {});
  }

  @Get('grep')
  grep(
    @Query('path') path: string,
    @Query('q') q: string,
    @Query('limit') limit: string,
    @Query('exclude') exclude: string,
    @Query('include') include: string,
    @Req() req: Request,
  ) {
    // Request dibatalkan browser (tombol Batal) -> hentikan proses grep.
    const controller = new AbortController();
    req.on('close', () => controller.abort());
    return this.files.grepText(path, q, Number(limit) || undefined, parseExclude(exclude), parseInclude(include), controller.signal);
  }

  @Get('search')
  search(
    @Query('path') path: string,
    @Query('q') q: string,
    @Query('all') all: string,
    @Query('exclude') exclude: string,
    @Query('include') include: string,
  ) {
    return this.files.search(path, q, all === '1', parseExclude(exclude), parseInclude(include));
  }

  @Get('du')
  du(@Query('path') path: string) {
    return this.files.dirSize(path);
  }

  /** Kirim berkas apa adanya; dukung Range supaya audio/video bisa di-seek. */
  @Get('raw')
  async raw(
    @Query('path') path: string,
    @Query('download') download: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const abs = await jailPath(path);
    const info = await stat(abs).catch(() => null);
    if (!info?.isFile()) {
      res.status(404).json({ message: 'File tidak bisa dibaca' });
      return;
    }
    const rawName = basename(abs);
    // Header HTTP hanya boleh ASCII: nama Unicode/kontrol (newline) bikin
    // ERR_INVALID_CHAR. Kirim fallback ASCII + filename* UTF-8 (RFC 5987).
    const fallback = rawName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'download';
    const encoded = encodeURIComponent(rawName).replace(/[!'()*]/g, (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase());
    res.setHeader('Content-Type', mimeOf(abs));
    res.setHeader(
      'Content-Disposition',
      (download === '1' ? 'attachment' : 'inline') + '; filename="' + fallback + '"; filename*=UTF-8\'\'' + encoded,
    );
    res.setHeader('Accept-Ranges', 'bytes');

    const header = String(req.headers.range ?? '');
    const match = /^bytes=(\d*)-(\d*)$/.exec(header);
    let start = 0;
    let end = info.size - 1;
    let status = 200;
    if (match && (match[1] || match[2])) {
      if (match[1]) start = Number(match[1]);
      if (match[2]) end = Math.min(Number(match[2]), info.size - 1);
      if (!match[1] && match[2]) {
        start = Math.max(0, info.size - Number(match[2]));
        end = info.size - 1;
      }
      if (start > end || start >= info.size) {
        res.status(416).setHeader('Content-Range', 'bytes */' + info.size);
        res.end();
        return;
      }
      status = 206;
      res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + info.size);
    }
    res.setHeader('Content-Length', String(end - start + 1));
    res.status(status);
    const stream = createReadStream(abs, { start, end });
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    stream.pipe(res);
  }


  /** Thumbnail kecil untuk daftar berkas (webp 96x96). */
  @Get('thumb')
  async thumb(@Query('path') path: string, @Res() res: Response) {
    const body = await this.files.thumbnail(String(path ?? ''));
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Content-Length', String(body.length));
    res.end(body);
  }

  @Put('write')
  write(@Body() body: { path: string; content: string }) {
    return this.files.writeText(body?.path, body?.content ?? '');
  }

  @Post('mkdir')
  mkdir(@Body() body: { path: string }) {
    return this.files.makeDir(body?.path);
  }

  @Post('rename')
  rename(@Body() body: { path: string; name: string }) {
    return this.files.renameTo(body?.path, body?.name);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(@Query('path') path: string, @UploadedFile() file: Uploaded) {
    return this.files.saveUpload(path, file?.originalname ?? '', file?.buffer ?? Buffer.alloc(0));
  }

  @Delete()
  remove(@Query('path') path: string) {
    return this.files.remove(path);
  }
}
