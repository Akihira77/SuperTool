import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Muat .env dari folder kerja (opsional, memakai API bawaan Node — tanpa dotenv).
try {
  process.loadEnvFile(join(process.cwd(), '.env'));
} catch {
  // file .env tidak ada: pakai env proses / default
}

const env = process.env;

function roots(raw: string | undefined): string[] {
  return (raw ?? homedir())
    .split(':')
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => resolve(path));
}

export const cfg = {
  port: Number(env.ST_PORT ?? 3001),
  host: env.ST_HOST ?? '127.0.0.1',
  dataDir: resolve(env.ST_DATA_DIR ?? join(process.cwd(), 'data')),
  fsRoots: roots(env.ST_FS_ROOTS),
  nginxDir: resolve(env.ST_NGINX_DIR ?? '/etc/nginx'),
  proxyAllowPublic: env.ST_PROXY_ALLOW_PUBLIC === '1',
  devOrigin: env.ST_DEV_ORIGIN ?? 'http://localhost:5173',
  webDist: resolve(env.ST_WEB_DIST ?? join(process.cwd(), '..', 'web', 'dist')),
};
