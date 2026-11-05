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

const xdgData = env.XDG_DATA_HOME || join(homedir(), '.local', 'share');

export const cfg = {
  port: Number(env.ST_PORT ?? 3001),
  host: env.ST_HOST ?? '127.0.0.1',
  // Data pengguna di luar folder project: aman dari git clean / reinstall.
  dataDir: resolve(env.ST_DATA_DIR ?? join(xdgData, 'super-tool')),
  fsRoots: roots(env.ST_FS_ROOTS),
  // Path log yang boleh dibaca Log Tailer di luar fsRoots (read-only).
  logRoots: (env.ST_LOG_ROOTS ?? '/var/log')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => resolve(item)),
  nginxDir: resolve(env.ST_NGINX_DIR ?? '/etc/nginx'),
  proxyAllowPublic: env.ST_PROXY_ALLOW_PUBLIC === '1',
  devOrigin: env.ST_DEV_ORIGIN ?? 'http://localhost:5173',
  webDist: resolve(env.ST_WEB_DIST ?? join(process.cwd(), '..', 'web', 'dist')),
  // Google Calendar (OAuth2). Kosong = endpoint calendar menolak dengan pesan jelas.
  calendar: {
    clientId: env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
    redirectUri:
      env.GOOGLE_REDIRECT_URI ?? 'http://127.0.0.1:' + Number(env.ST_PORT ?? 3001) + '/api/calendar/callback',
  },
  // LLM kompatibel OpenAI (9router, ollama, dsb). Default: 9router lokal.
  llm: {
    baseUrl: env.ST_LLM_BASE_URL ?? 'http://127.0.0.1:20128/v1',
    model: env.ST_LLM_MODEL ?? '',
    apiKey: env.ST_LLM_API_KEY ?? '',
  },
};
