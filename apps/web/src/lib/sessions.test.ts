import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSessionStore, MAX_SESSIONS, newSession, saveSessionStore, subscribeSessionStore } from './sessions';

function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
    data,
  };
}

describe('session container', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('menyimpan lalu memuat sesi dan tab aktif', () => {
    vi.stubGlobal('localStorage', storage());
    const first = newSession('files', 'Berkas');
    const second = newSession('notes');
    saveSessionStore({ sessions: [first, second], activeId: second.id });
    expect(loadSessionStore()).toEqual({ sessions: [first, second], activeId: second.id });
  });

  it('memperbaiki data rusak dan membatasi jumlah sesi', () => {
    const sessions = Array.from({ length: MAX_SESSIONS + 5 }, (_, index) => ({
      id: 's' + index,
      tool: 'files',
      name: '',
    }));
    const fake = storage({
      'st:sessions:v1': JSON.stringify({ version: 1, sessions, activeId: 'tidak-ada' }),
    });
    vi.stubGlobal('localStorage', fake);
    const restored = loadSessionStore();
    expect(restored?.sessions).toHaveLength(MAX_SESSIONS);
    expect(restored?.activeId).toBe('s0');

    fake.data.set('st:sessions:v1', '{rusak');
    expect(loadSessionStore()).toBeNull();
  });

  it('menyinkronkan perubahan dari tab lain hanya untuk key sesi', () => {
    const fake = storage();
    vi.stubGlobal('localStorage', fake);
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const listener = vi.fn();
    const off = subscribeSessionStore(listener);

    const event = new Event('storage') as StorageEvent;
    Object.defineProperty(event, 'key', { value: 'st:sessions:v1' });
    Object.defineProperty(event, 'newValue', {
      value: JSON.stringify({ version: 1, sessions: [{ id: 'a', tool: 'files', name: '' }], activeId: 'a' }),
    });
    target.dispatchEvent(event);
    expect(listener).toHaveBeenCalledWith({ sessions: [{ id: 'a', tool: 'files', name: '' }], activeId: 'a' });

    const other = new Event('storage') as StorageEvent;
    Object.defineProperty(other, 'key', { value: 'st:files:root' });
    Object.defineProperty(other, 'newValue', { value: 'x' });
    target.dispatchEvent(other);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });
});
