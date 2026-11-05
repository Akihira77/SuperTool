import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
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

  @Get('search')
  search(@Query('path') path: string, @Query('q') q: string, @Query('all') all: string) {
    return this.files.search(path, q, all === '1');
  }

  @Get('du')
  du(@Query('path') path: string) {
    return this.files.dirSize(path);
  }

  @Get('raw')
  async raw(@Query('path') path: string, @Query('download') download: string, @Res() res: Response) {
    const abs = await jailPath(path);
    const name = basename(abs);
    res.setHeader('Content-Type', mimeOf(abs));
    res.setHeader(
      'Content-Disposition',
      (download === '1' ? 'attachment' : 'inline') + '; filename="' + name.replace(/"/g, '') + '"',
    );
    res.sendFile(abs, (err) => {
      if (err) res.status(404).json({ message: 'File tidak bisa dibaca' });
    });
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
