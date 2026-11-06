import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { all, one, recentPaths, run } from '../../common/db';
import { StorageUsageController } from './storage-usage.controller';
import { StorageUsageService } from './storage-usage.service';

type UrlRow = { id: string; name: string; url: string; proxy: number; createdAt: number };
type UrlView = { id: string; name: string; url: string; proxy: boolean; createdAt: number };

function toView(row: UrlRow): UrlView {
  return { id: row.id, name: row.name, url: row.url, proxy: row.proxy === 1, createdAt: row.createdAt };
}

function clean(input: { name?: string; url?: string }) {
  const raw = String(input?.url ?? '').trim();
  if (!raw) throw new BadRequestException('URL wajib diisi');
  // Skema selain http/https langsung ditolak, jangan ditempel "http://" dulu.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  if (hasScheme && !/^https?:\/\//i.test(raw)) throw new BadRequestException('Hanya http/https');
  let parsed: URL;
  try {
    parsed = new URL(hasScheme ? raw : 'http://' + raw);
  } catch {
    throw new BadRequestException('URL tidak valid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('Hanya http/https');
  }
  const url = (parsed.origin + parsed.pathname).replace(/\/$/, '');
  return { name: String(input?.name ?? '').trim().slice(0, 80) || parsed.host, url };
}

/** Daftar URL di URL Viewer — data pengguna, jadi masuk database. */
@Controller('urls')
export class UrlsController {
  @Get()
  list() {
    return { urls: all<UrlRow>('SELECT id, name, url, proxy, created_at AS createdAt FROM urls ORDER BY created_at').map(toView) };
  }

  @Post()
  create(@Body() body: { name?: string; url?: string; proxy?: boolean }) {
    const { name, url } = clean(body);
    const id = randomUUID();
    const createdAt = Date.now();
    run('INSERT INTO urls (id, name, url, proxy, created_at) VALUES (?, ?, ?, ?, ?)', id, name, url, body?.proxy ? 1 : 0, createdAt);
    return { ok: true, url: toView({ id, name, url, proxy: body?.proxy ? 1 : 0, createdAt }) };
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: { name?: string; url?: string; proxy?: boolean }) {
    const current = one<UrlRow>('SELECT id, name, url, proxy, created_at AS createdAt FROM urls WHERE id = ?', id);
    if (!current) throw new NotFoundException('URL tidak ditemukan');
    const next = body?.url !== undefined ? clean({ name: body.name ?? current.name, url: body.url }) : { name: body?.name?.slice(0, 80) ?? current.name, url: current.url };
    const proxy = body?.proxy === undefined ? current.proxy : body.proxy ? 1 : 0;
    run('UPDATE urls SET name = ?, url = ?, proxy = ? WHERE id = ?', next.name, next.url, proxy, id);
    return { ok: true, url: toView({ ...current, name: next.name, url: next.url, proxy }) };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    if (run('DELETE FROM urls WHERE id = ?', id) === 0) throw new NotFoundException('URL tidak ditemukan');
    return { ok: true };
  }
}

/** Path yang pernah dibuka per tool. Isi file tetap di disk. */
@Controller('recent')
export class RecentController {
  @Get()
  list(@Query('kind') kind?: string) {
    const key = String(kind ?? 'nginx').slice(0, 20);
    return { kind: key, paths: recentPaths(key, 8) };
  }
}

@Module({
  controllers: [UrlsController, RecentController, StorageUsageController],
  providers: [StorageUsageService],
})
export class StorageModule {}
