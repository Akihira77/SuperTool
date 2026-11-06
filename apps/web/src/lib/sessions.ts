export type ToolSession = {
  /** Identitas tab; tidak bergantung pada tool. */
  id: string;
  /** Id tool dari katalog App. */
  tool: string;
  /** Nama yang bisa diubah user. */
  name: string;
};

export type SessionStore = {
  sessions: ToolSession[];
  activeId: string | null;
};

const KEY = 'st:sessions:v1';
const VERSION = 1;
export const MAX_SESSIONS = 16;
const MAX_NAME = 80;

export function newSession(tool: string, name = ''): ToolSession {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  return { id, tool, name: name.trim().slice(0, MAX_NAME) };
}

function normalize(raw: unknown): SessionStore | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as { sessions?: unknown; activeId?: unknown };
  if (!Array.isArray(value.sessions)) return null;

  const seen = new Set<string>();
  const sessions: ToolSession[] = [];
  for (const item of value.sessions) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as { id?: unknown; tool?: unknown; name?: unknown };
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.tool !== 'string' ||
      typeof candidate.name !== 'string' ||
      !candidate.id ||
      !candidate.tool ||
      seen.has(candidate.id)
    ) {
      continue;
    }
    seen.add(candidate.id);
    sessions.push({
      id: candidate.id.slice(0, 64),
      tool: candidate.tool.slice(0, 64),
      name: candidate.name.trim().slice(0, MAX_NAME),
    });
    if (sessions.length >= MAX_SESSIONS) break;
  }

  const activeId =
    typeof value.activeId === 'string' && sessions.some((session) => session.id === value.activeId)
      ? value.activeId
      : sessions[0]?.id ?? null;
  return { sessions, activeId };
}

export function loadSessionStore(): SessionStore | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveSessionStore(store: SessionStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, ...store }));
  } catch {
    // localStorage penuh/private mode: sesi tetap jalan sampai tab ditutup.
  }
}

/** Sinkron antar-tab lewat event storage; tidak perlu polling. */
export function subscribeSessionStore(listener: (store: SessionStore) => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY || !event.newValue) return;
    try {
      const store = normalize(JSON.parse(event.newValue));
      if (store) listener(store);
    } catch {
      // abaikan payload rusak dari tab lain
    }
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
