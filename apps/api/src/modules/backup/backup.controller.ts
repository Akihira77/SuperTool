import { Controller, Get, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cfg } from '../../config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { BackupService } from './backup.service';

type Uploaded = { originalname: string; path?: string; buffer?: Buffer; size: number };

// Multer menulis berkas ke disk: backup 100 MB tidak lagi ditampung di RAM.
const RESTORE_TMP = join(cfg.tempDir, 'restore');
mkdirSync(RESTORE_TMP, { recursive: true });

/** Unduh backup (.zip) berisi database + folder uploads. */
@Controller('backup')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get()
  download(@Res() res: Response) {
    return this.backup.download(res);
  }
}

/** Pulihkan database dari file .zip hasil backup. */
@Controller('restore')
export class RestoreController {
  constructor(private readonly backup: BackupService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { dest: RESTORE_TMP, limits: { fileSize: 100 * 1024 * 1024 } }),
  )
  restore(@UploadedFile() file: Uploaded) {
    return this.backup.restore(file);
  }
}
