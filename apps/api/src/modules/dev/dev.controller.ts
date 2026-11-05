import { Body, Controller, Delete, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DevService } from './dev.service';

@Controller('dev')
export class DevController {
  constructor(private readonly dev: DevService) {}

  @Post('hash')
  hash(@Body() body: { text?: string; algo?: string; hmacKey?: string }) {
    return this.dev.hash(body ?? {});
  }

  @Post('http')
  http(
    @Body()
    body: { method?: string; url?: string; headers?: Array<{ key?: string; value?: string }>; body?: string; timeoutMs?: number },
  ) {
    return this.dev.http(body ?? {});
  }

  @Get('logs')
  logs(@Query('path') path: string, @Query('lines') lines: string) {
    return this.dev.logs(path, Number(lines) || 300);
  }

  @Get('logs/stream')
  stream(@Query('path') path: string, @Req() req: Request, @Res() res: Response) {
    return this.dev.streamLogs(path, req, res);
  }

  @Get('docker')
  async docker(@Query('view') view: string, @Query('id') id: string) {
    if (view === 'images') return this.dev.dockerImages();
    if (view === 'logs') return this.dev.dockerLogs(id);
    return this.dev.dockerContainers();
  }

  @Get('cron')
  cronList() {
    return this.dev.cronList();
  }

  @Post('cron')
  cronAdd(@Body() body: { line?: string }) {
    return this.dev.cronAdd(String(body?.line ?? ''));
  }

  @Delete('cron')
  cronRemove(@Query('index') index: string) {
    return this.dev.cronRemove(Number(index));
  }

  @Get('dns')
  dns(@Query('host') host: string) {
    return this.dev.dnsLookup(host);
  }

  @Get('git')
  git(@Query('path') path: string, @Query('ref') ref?: string) {
    return this.dev.git(path, ref);
  }

  @Post('git/stage')
  stage(@Body() body: { path?: string; files?: string[]; action?: string }) {
    return this.dev.gitStage(body?.path ?? '', body?.files ?? [], body?.action ?? 'stage');
  }

  @Get('git/diff')
  diff(@Query('path') path: string, @Query('file') file: string, @Query('staged') staged?: string) {
    return this.dev.gitDiff(path, file, staged === '1');
  }

  @Get('git/show')
  show(@Query('path') path: string, @Query('hash') hash: string) {
    return this.dev.gitShow(path, hash);
  }
}
