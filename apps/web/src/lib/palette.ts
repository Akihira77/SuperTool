import { useEffect, useRef } from 'react';

/**
 * Jembatan command palette → tool yang sedang aktif.
 *
 * Palette tidak memegang state tiap tool. Ia hanya:
 * 1. `inject` intent (tool + aksi + payload), lalu
 * 2. menunggu tool yang bersangkutan mendaftar lewat `usePaletteIntent`.
 *
 * Untuk aksi sederhana (format, refresh, buka tab) cukup tandai tombol dengan
 * `data-action="tool:aksi"`; palette akan mengkliknya setelah tool tampil.
 */
export type PaletteIntent = { tool: string; action: string; payload?: unknown };

let pending: PaletteIntent | null = null;
const handlers = new Set<(intent: PaletteIntent) => void>();

export function dispatchIntent(intent: PaletteIntent) {
  pending = intent;
  for (const handler of handlers) handler(intent);
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

async function waitFor(selector: string, tries = 40) {
  for (let index = 0; index < tries; index += 1) {
    const node = document.querySelector<HTMLElement>(selector);
    if (node) return node;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

/** Klik elemen ber-atribut data-action="tool:aksi" setelah halaman tool muncul. */
export async function runClick(tool: string, action: string) {
  const node = await waitFor('[data-action="' + tool + ':' + action + '"]');
  node?.click();
  return Boolean(node);
}

/** Fokus elemen (input/textarea) ber-atribut data-action. */
export async function runFocus(tool: string, action: string) {
  const node = await waitFor('[data-action="' + tool + ':' + action + '"]');
  node?.focus();
  return Boolean(node);
}

export type FilesSearchPayload = { query: string; mode: 'name' | 'content'; include: string; exclude: string };
