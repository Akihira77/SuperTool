export type LogLevel = 'log' | 'warn' | 'error' | 'debug' | 'verbose';

export type LogEntry = {
  ts: number;
  level: LogLevel;
  context: string;
  message: string;
};

const MAX_ENTRIES = 400;
const MAX_LENGTH = 1200;
const entries: LogEntry[] = [];

function clean(value: string): string {
  return value
    .replace(/(password|secret|token|authorization|tiket)(["']?\s*[:=]\s*)[^\s,;&]+/gi, '$1$2[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_LENGTH);
}

/** Ring buffer log proses untuk pusat diagnostik; tidak menulis ke disk. */
export function pushLog(level: LogLevel, message: string, context = ''): void {
  entries.push({ ts: Date.now(), level, context: context.slice(0, 60), message: clean(message) });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function recentLogs(limit = 40): LogEntry[] {
  const count = Math.max(1, Math.min(200, Math.floor(Number(limit) || 40)));
  return entries.slice(-count);
}
