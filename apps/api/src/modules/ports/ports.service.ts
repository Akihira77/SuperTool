import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';

type PortRow = {
  proto: string;
  address: string;
  port: number;
  pid: number | null;
  process: string;
  cmd: string;
  uptimeSec: number | null;
  established: number;
};

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

@Injectable()
export class PortsService {
  async snapshot(): Promise<{ ports: PortRow[]; generatedAt: number }> {
    let listening: string;
    try {
      listening = await run('ss', ['-ltnpH']);
    } catch {
      throw new Error('Perintah "ss" tidak tersedia. Install iproute2 (Debian/Ubuntu) atau iproute (Arch).');
    }
    const rows: PortRow[] = [];
    for (const line of listening.split('\n')) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 5) continue;
      const local = cols[3];
      const sep = local.lastIndexOf(':');
      if (sep < 0) continue;
      const port = Number(local.slice(sep + 1));
      if (!Number.isFinite(port)) continue;
      const tail = cols.slice(5).join(' ');
      const pid = Number((/pid=(\d+)/.exec(tail) ?? [])[1] ?? '') || null;
      const process = (/\("([^"]+)"/.exec(tail) ?? [])[1] ?? '';
      rows.push({
        proto: 'tcp',
        address: local.slice(0, sep) || '0.0.0.0',
        port,
        pid,
        process,
        cmd: '',
        uptimeSec: null,
        established: 0,
      });
    }

    const pids = [...new Set(rows.map((r) => r.pid).filter((p): p is number => !!p))];
    if (pids.length) {
      try {
        const ps = await run('ps', ['-o', 'pid=,etimes=,args=', '-p', pids.join(',')]);
        const meta = new Map<number, { etimes: number; args: string }>();
        for (const line of ps.split('\n')) {
          const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
          if (m) meta.set(Number(m[1]), { etimes: Number(m[2]), args: m[3] });
        }
        for (const row of rows) {
          const info = row.pid ? meta.get(row.pid) : undefined;
          if (!info) continue;
          row.uptimeSec = info.etimes;
          row.cmd = info.args;
          if (!row.process) row.process = info.args.split(' ')[0].split('/').pop() ?? '';
        }
      } catch {
        // proses sudah mati / ps tidak bisa membaca: biarkan kosong
      }
    }

    try {
      const established = await run('ss', ['-tnH', 'state', 'established']);
      const counts = new Map<number, number>();
      for (const line of established.split('\n')) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 4) continue;
        const local = cols[3];
        const sep = local.lastIndexOf(':');
        if (sep < 0) continue;
        const port = Number(local.slice(sep + 1));
        counts.set(port, (counts.get(port) ?? 0) + 1);
      }
      for (const row of rows) row.established = counts.get(row.port) ?? 0;
    } catch {
      // statistik koneksi opsional
    }

    rows.sort((a, b) => a.port - b.port);
    return { ports: rows, generatedAt: Date.now() };
  }
}
