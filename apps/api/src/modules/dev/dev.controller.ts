import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DevService } from './dev.service';
import { HttpStoreService } from './http-store.service';

@Controller('dev')
export class DevController {
  constructor(
    private readonly dev: DevService,
    private readonly store: HttpStoreService,
  ) {}

  @Post('hash')
  hash(@Body() body: { text?: string; algo?: string; hmacKey?: string }) {
    return this.dev.hash(body ?? {});
  }

  @Post('http')
  async http(
    @Body()
    body: { method?: string; url?: string; headers?: Array<{ key?: string; value?: string }>; body?: string; timeoutMs?: number },
  ) {
    const method = String(body?.method ?? 'GET').toUpperCase();
    const url = String(body?.url ?? '');
    try {
      const result = await this.dev.http(body ?? {});
      this.store.record({ method, url: result.url, status: result.status, durationMs: result.ms, size: result.size });
      return result;
    } catch (error) {
      this.store.record({ method, url, error: error instanceof Error ? error.message : 'Request gagal' });
      throw error;
    }
  }

  @Get('http/saved')
  saved(@Query('query') query = '') {
    return this.store.list(query);
  }

  @Post('http/saved')
  saveRequest(@Body() body: Record<string, unknown>) {
    return this.store.save(body ?? {});
  }

  @Delete('http/saved/:id')
  removeSaved(@Param('id') id: string) {
    return this.store.remove(id);
  }

  @Get('http/collections')
  collections() {
    return this.store.collections();
  }

  @Post('http/collections')
  saveCollection(@Body() body: Record<string, unknown>) {
    return this.store.saveCollection(body ?? {});
  }

  @Delete('http/collections/:id')
  removeCollection(@Param('id') id: string) {
    return this.store.removeCollection(id);
  }

  @Get('http/environments')
  environments() {
    return this.store.environments();
  }

  @Post('http/environments')
  saveEnvironment(@Body() body: Record<string, unknown>) {
    return this.store.saveEnvironment(body ?? {});
  }

  @Delete('http/environments/:id')
  removeEnvironment(@Param('id') id: string) {
    return this.store.removeEnvironment(id);
  }

  @Get('http/history')
  history(@Query('limit') limit?: string) {
    return this.store.history(Number(limit) || 30);
  }

  @Delete('http/history')
  clearHistory() {
    return this.store.clearHistory();
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

  @Post('docker/action')
  dockerAction(@Body() body: { action?: string; id?: string }) {
    return this.dev.dockerAction(body?.action ?? '', body?.id ?? '');
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

  @Post('git/branch')
  branch(@Body() body: { path?: string; action?: string; name?: string }) {
    return this.dev.gitBranch(body?.path ?? '', body?.action ?? 'switch', body?.name ?? '');
  }

  @Post('git/commit')
  commit(@Body() body: { path?: string; message?: string }) {
    return this.dev.gitCommit(body?.path ?? '', body?.message);
  }

  @Post('git/stash')
  stash(@Body() body: { path?: string; action?: string; index?: number; message?: string }) {
    return this.dev.gitStash(body?.path ?? '', body?.action ?? '', body?.index, body?.message);
  }
}
