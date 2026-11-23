import type { NextFunction, Request, Response } from 'express';

const DEFAULT_IDLE_MS = 120_000;
const MAX_IDLE_MS = 60 * 60 * 1000;

/** `0`/negatif = nonaktif; nilai tak wajar jatuh ke default. */
export function bodyIdleMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_IDLE_MS;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_IDLE_MS;
  if (value <= 0) return 0;
  return Math.min(value, MAX_IDLE_MS);
}

function expectsBody(req: Request): boolean {
  if (req.headers['transfer-encoding']) return true;
  const length = Number(req.headers['content-length']);
  return Number.isFinite(length) && length > 0;
}

/**
 * Batas idle body untuk semua route, dipasang sebelum proxy, webhook, audit,
 * dan body parser. Memakai inactivity timeout socket: upload multi-GB tetap
 * boleh selama data mengalir, sedangkan body yang macet ditutup. Timer dilepas
 * begitu body selesai supaya respons/proses lambat setelahnya tidak diputus.
 */
export function bodyIdleGuard(idleMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (idleMs <= 0 || !expectsBody(req)) {
      next();
      return;
    }
    const socket = req.socket;
    const onTimeout = (): void => {
      // Body tidak mengalir: tutup koneksi. Menulis respons di tengah body yang
      // belum diterima tidak bisa diandalkan (Node menahan write), jadi destroy.
      socket.destroy();
    };
    socket.setTimeout(idleMs, onTimeout);

    let cleared = false;
    const clear = (): void => {
      if (cleared) return;
      cleared = true;
      // `setTimeout(0)` hanya mematikan timer; callback dari setTimeout(ms, cb)
      // tetap terpasang sebagai listener 'timeout'. Di keep-alive listener itu
      // akan menumpuk, jadi listener milik middleware ini dilepas eksplisit.
      socket.removeListener('timeout', onTimeout);
      if (!socket.destroyed) socket.setTimeout(0);
      // Lepas referensi request/response secepat mungkin; semua `once`.
      req.removeListener('end', clear);
      req.removeListener('close', clear);
      req.removeListener('aborted', clear);
      res.removeListener('close', clear);
      res.removeListener('finish', clear);
    };
    req.once('end', clear);
    req.once('close', clear);
    req.once('aborted', clear);
    res.once('close', clear);
    res.once('finish', clear);
    next();
  };
}
