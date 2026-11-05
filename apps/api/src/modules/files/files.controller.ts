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
  grep(@Query('path') path: string, @Query('q') q: string, @Query('limit') limit: string) {
    return this.files.grepText(path, q, Number(limit) || undefined);
  }

  @Get('search')
  search(@Query('path') path: string, @Query('q') q: string, @Query('all') all: string) {
    return this.files.search(path, q, all === '1');
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
    const name = basename(abs).replace(/"/g, '');
    res.setHeader('Content-Type', mimeOf(abs));
    res.setHeader('Content-Disposition', (download === '1' ? 'attachment' : 'inline') + '; filename="' + name + '"');
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
