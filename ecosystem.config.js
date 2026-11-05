const path = require('node:path');

const ROOT = __dirname;
const LOG_DIR = path.join(ROOT, 'logs');

/**
 * Super Tool — konfigurasi PM2.
 *
 * Backend menyajikan API + hasil build frontend dari apps/web/dist, jadi
 * satu proses sudah cukup untuk produksi. App web di bawah ini opsional:
 * hanya untuk preview terpisah di port 4173.
 */
module.exports = {
  apps: [
    {
      name: 'super-tool-api',
      cwd: path.join(ROOT, 'apps', 'api'),
      script: 'dist/main.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,
      kill_timeout: 5000,
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: path.join(LOG_DIR, 'api.out.log'),
      error_file: path.join(LOG_DIR, 'api.err.log'),
      env: {
        NODE_ENV: 'production',
        ST_PORT: '3001',
        ST_HOST: '127.0.0.1',
      },
    },
    {
      name: 'super-tool-web',
      cwd: path.join(ROOT, 'apps', 'web'),
      // Build dulu: pnpm --filter @super-tool/web build
      script: 'node_modules/vite/bin/vite.js',
      interpreter: 'node',
      args: 'preview --host 127.0.0.1 --port 4173',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,
      kill_timeout: 5000,
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: path.join(LOG_DIR, 'web.out.log'),
      error_file: path.join(LOG_DIR, 'web.err.log'),
      env: {
        NODE_ENV: 'production',
      },
      // UI produksi tetap disajikan backend di :3001. App ini hanya
      // preview terpisah di :4173; boleh dimatikan dengan pm2 stop.
      autostart: true,
    },
  ],
};
