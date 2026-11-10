import { useEffect, useRef } from 'react';

/**
 * Jembatan command palette → tool yang sedang aktif.
 *
 * Palette tidak memegang state tiap tool. Ia hanya:
 * 1. mengirim intent (tool + aksi + payload), lalu
 * 2. menunggu tool yang bersangkutan mendaftar lewat `usePaletteIntent`.
 *
 * Tool yang belum ter-mount menyimpan intent sebagai pending; tool tersebut
 * mengambilnya sekali saat mount. Fokus dan klik elemen `data-action` tidak
 * lagi dilakukan di sini: App menunggu sesi tujuan aktif dan terlihat, lalu
 * memakai target yang dibatasi ke root sesi itu (lihat App.tsx).
 */
export type PaletteIntent = { tool: string; action: string; payload?: unknown };

let pending: PaletteIntent | null = null;
const handlers = new Set<(intent: PaletteIntent) => void>();

export function dispatchIntent(intent: PaletteIntent) {
  pending = intent;
  for (const handler of handlers) handler(intent);
}

/** Buang intent yang belum diambil, misalnya saat pengguna membatalkan aksi. */
export function clearPendingIntent() {
  pending = null;
}

/** Dipakai tool: daftarkan satu handler; intent yang tertunda langsung dijalankan. */
export function usePaletteIntent(tool: string, handler: (action: string, payload?: unknown) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const run = (intent: PaletteIntent) => {
      if (intent.tool !== tool) return;
      if (pending === intent) pending = null;
      ref.current(intent.action, intent.payload);
    };
    handlers.add(run);
    if (pending && pending.tool === tool) run(pending);
    return () => {
      handlers.delete(run);
    };
  }, [tool]);
}

export type FilesSearchPayload = { query: string; mode: 'name' | 'content'; include: string; exclude: string };
