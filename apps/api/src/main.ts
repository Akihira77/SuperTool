import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { auditHttp } from './common/audit-http.middleware';
import { one } from './common/db';
import { cfg } from './config';
import { AuditService } from './modules/audit/audit.service';
import { AuthService } from './modules/auth/auth.service';
import { handleProxyRequest, handleProxyUpgrade, PROXY_PREFIX, subdomainTarget } from './modules/proxy/proxy.middleware';

async function bootstrap() {
  // Body parser dimatikan dulu: proxy harus menerima body mentah sebelum di-parse.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.setGlobalPrefix('api');
  app.set('trust proxy', 'loopback');
  app.enableShutdownHooks();
  // CORS hanya aktif kalau diminta eksplisit; UI memakai origin yang sama (Vite proxy).
  if (cfg.devOrigin) app.enableCors({ origin: cfg.devOrigin, credentials: true });

  const auth = app.get(AuthService);
  const instance = app.getHttpAdapter().getInstance();

  // Header keamanan untuk aplikasi; konten proxy tidak boleh di-frame-lock di sini
  // karena memang ditampilkan di iframe (mode path punya CSP sandbox sendiri).
  instance.use((req: any, res: any, next: () => void) => {
    const proxied = (req.url ?? '').startsWith(PROXY_PREFIX) || Boolean(subdomainTarget(req.headers.host));
    if (!proxied) {
      res.setHeader('x-frame-options', 'DENY');
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('referrer-policy', 'no-referrer');
      res.setHeader(
        'content-security-policy',
        "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
      );
    }
    next();
  });

  instance.get('/api/health', (_req: any, res: any) => {
    try {
      one('SELECT 1');
      res.json({ ok: true, uptime: Math.round(process.uptime()) });
    } catch (err) {
      res.status(503).json({ ok: false, error: (err as Error).message });
    }
  });

  // Proxy path-prefix (/api/proxy/b/<token>/...) untuk tool yang memblokir iframe.
  instance.use((req: any, res: any, next: () => void) => {
    handleProxyRequest(req, res, auth)
      .then((handled) => {
        if (!handled) next();
      })
      .catch(() => {
        if (!res.headersSent) res.statusCode = 502;
        res.end();
      });
  });

  // Webhook receiver butuh body mentah apa adanya (JSON, form, teks, biner kecil).
  // Kumpulkan sendiri tanpa body-parser: req._body = true membuat parser JSON di
  // bawahnya melewati route ini, jadi endpoint lain tetap aman.
  instance.use('/api/hook', (req: any, res: any, next: () => void) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) {
        done = true;
        res.statusCode = 413;
        res.end('Body terlalu besar');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      req.body = Buffer.concat(chunks);
      req._body = true;
      next();
    });
    req.on('error', () => next());
  });

  // Catat semua request API sebelum parser body; payload dibaca saat respons selesai.
  instance.use('/api', auditHttp(app.get(AuditService)));

  // Setelah proxy: baru parse JSON untuk endpoint sendiri.
  app.useBodyParser('json', { limit: '25mb' });

  const indexFile = join(cfg.webDist, 'index.html');
  if (existsSync(indexFile)) {
    app.useStaticAssets(cfg.webDist, { index: false });
    instance.use((req: any, res: any, next: () => void) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(indexFile);
    });
  }

  const server = app.getHttpServer();
  // Upload multipart berukuran GB tidak boleh diputus requestTimeout 5 menit
  // bawaan Node. Batas ukuran tetap dijaga di FileInterceptor.
  server.requestTimeout = 0;
  server.headersTimeout = 120_000;
  server.on('upgrade', (req: any, socket: any, head: Buffer) => {
    if (!handleProxyUpgrade(req, socket, head, auth)) socket.destroy();
  });

  await app.listen(cfg.port, cfg.host);
  const url = 'http://' + cfg.host + ':' + cfg.port;
  console.log('Super Tool siap di ' + url);
  console.log('Root file explorer: ' + cfg.fsRoots.join(', '));
}

process.on('unhandledRejection', (reason) => {
  console.error('[super-tool] unhandledRejection', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[super-tool] uncaughtException', err);
  process.exitCode = 1;
});

bootstrap().catch((err) => {
  console.error('[super-tool] gagal start', err);
  process.exitCode = 1;
});
