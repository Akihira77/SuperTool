import { afterEach, describe, expect, it, vi } from 'vitest';
import { REMIND_KEY, readRemindBefore } from './calendar-reminder';

function stubStorage(getItem: (key: string) => string | null) {
  vi.stubGlobal('localStorage', { getItem });
}

function readStored(raw: string | null): number {
  stubStorage(() => raw);
  return readRemindBefore();
}

describe('readRemindBefore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('memakai default 30 menit saat key belum ada', () => {
    expect(readStored(null)).toBe(30);
  });

  it('menghormati preferensi nonaktif eksplisit', () => {
    expect(readStored('0')).toBe(0);
  });

  it('membaca pilihan yang valid', () => {
    expect(readStored('15')).toBe(15);
    expect(readStored('30')).toBe(30);
    expect(readStored('60')).toBe(60);
  });

  it('kembali ke default untuk nilai tidak valid', () => {
    expect(readStored('abc')).toBe(30);
    expect(readStored('')).toBe(30);
    expect(readStored('45')).toBe(30);
    expect(readStored('-15')).toBe(30);
    expect(readStored('30menit')).toBe(30);
  });

  it('kembali ke default saat localStorage melempar error', () => {
    stubStorage(() => {
      throw new Error('blocked');
    });
    expect(readRemindBefore()).toBe(30);
  });

  it('hanya membaca key pengingat', () => {
    const seen: string[] = [];
    stubStorage((key) => {
      seen.push(key);
      return '15';
    });
    expect(readRemindBefore()).toBe(15);
    expect(seen).toEqual([REMIND_KEY]);
  });
});
