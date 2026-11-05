import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { cfg } from './config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.useBodyParser('json', { limit: '25mb' });
  app.enableCors({ origin: cfg.devOrigin, credentials: true });

  const indexFile = join(cfg.webDist, 'index.html');
  if (existsSync(indexFile)) {
    app.useStaticAssets(cfg.webDist, { index: false });
    const instance = app.getHttpAdapter().getInstance();
    instance.use((req: any, res: any, next: () => void) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(indexFile);
    });
  }

  await app.listen(cfg.port, cfg.host);
  const url = 'http://' + cfg.host + ':' + cfg.port;
  console.log('Super Tool siap di ' + url);
  console.log('Root file explorer: ' + cfg.fsRoots.join(', '));
}

void bootstrap();
