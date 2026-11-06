const MAX_PAYLOAD = 64_000;
const MAX_STRING = 8_000;
const MAX_ARRAY = 200;
const MAX_KEYS = 100;
const MAX_DEPTH = 8;

const SECRET_KEYS = new Set([
  'password',
  'passwd',
  'currentpassword',
  'newpassword',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'setcookie',
  'apikey',
  'xstcsrf',
  'cookies',
]);

function shouldRedact(key: string): boolean {
  return SECRET_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''));
}

function truncate(value: string): string {
  return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '…[truncated]' : value;
}

/** Serialize payload audit dengan batas ukuran dan redaksi rahasia. */
export function serializeAuditPayload(value: unknown): string {
  const seen = new WeakSet<object>();

  const walk = (input: unknown, depth: number): unknown => {
    if (input === null || input === undefined) return input ?? null;
    if (typeof input === 'string') return truncate(input);
    if (typeof input === 'number' || typeof input === 'boolean') return input;
    if (typeof input === 'bigint') return input.toString();
    if (typeof input === 'function' || typeof input === 'symbol') return '[unserializable]';
    if (input instanceof Date) return input.toISOString();
    if (Buffer.isBuffer(input)) {
      return {
        type: 'Buffer',
        bytes: input.length,
        preview: input.length <= MAX_STRING ? input.toString('utf8') : undefined,
      };
    }
    if (input instanceof Error) return truncate(input.message);
    if (depth >= MAX_DEPTH) return '[max-depth]';
    if (typeof input === 'object') {
      if (seen.has(input)) return '[circular]';
      seen.add(input);
      if (Array.isArray(input)) {
        const items = input.slice(0, MAX_ARRAY).map((item) => walk(item, depth + 1));
        if (input.length > MAX_ARRAY) items.push('…[truncated]');
        return items;
      }
      const output: Record<string, unknown> = {};
      const keys = Object.keys(input as Record<string, unknown>).slice(0, MAX_KEYS);
      for (const key of keys) {
        output[key] = shouldRedact(key) ? '[REDACTED]' : walk((input as Record<string, unknown>)[key], depth + 1);
      }
      if (Object.keys(input as Record<string, unknown>).length > MAX_KEYS) output.__truncated = true;
      return output;
    }
    return String(input);
  };

  try {
    const json = JSON.stringify(walk(value, 0));
    if (json.length <= MAX_PAYLOAD) return json;
    return JSON.stringify({ truncated: true, preview: json.slice(0, MAX_PAYLOAD) });
  } catch {
    return JSON.stringify({ error: 'payload tidak bisa diserialisasi' });
  }
}
