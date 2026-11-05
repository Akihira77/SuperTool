import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { cfg } from './config';
import { AuthService } from './modules/auth/auth.service';
import { handleProxyRequest, handleProxyUpgrade } from './modules/proxy/proxy.middleware';

async function bootstrap() {
  // Body parser dimatikan dulu: proxy harus menerima body mentah sebelum di-parse.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: cfg.devOrigin, credentials: true });

  // Proxy path-prefix (/api/proxy/b/<token>/...) untuk tool yang memblokir iframe.
  const auth = app.get(AuthService);
  const instance = app.getHttpAdapter().getInstance();
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

  app.getHttpServer().on('upgrade', (req: any, socket: any, head: Buffer) => {
    if (!handleProxyUpgrade(req, socket, head, auth)) socket.destroy();
  });

  await app.listen(cfg.port, cfg.host);
  const url = 'http://' + cfg.host + ':' + cfg.port;
  console.log('Super Tool siap di ' + url);
  console.log('Root file explorer: ' + cfg.fsRoots.join(', '));
}

void bootstrap();
