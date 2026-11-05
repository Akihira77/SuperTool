import { ForbiddenException } from '@nestjs/common';
import { realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { cfg } from '../config';

export function inRoots(abs: string, roots: string[]): boolean {
  return roots.some((root) => (root === sep ? abs.startsWith(sep) : abs === root || abs.startsWith(root + sep)));
}

/** Batasi path ke root yang diizinkan, lalu cek symlink supaya tidak bisa kabur. */
export async function jailPath(input: string, roots: string[] = cfg.fsRoots): Promise<string> {
  const abs = resolve(input);
  if (!inRoots(abs, roots)) {
    throw new ForbiddenException('Path di luar area yang diizinkan');
  }
  let probe = abs;
  for (;;) {
    try {
      const real = await realpath(probe);
      if (!inRoots(real, roots)) throw new ForbiddenException('Symlink menunjuk keluar area izin');
      return abs;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
      const parent = dirname(probe);
      if (parent === probe) return abs;
      probe = parent;
    }
  }
}
