import { BadRequestException, Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os';

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

export type ProcRow = {
  pid: number;
  ppid: number;
  user: string;
  cpu: number;
  mem: number;
  rssKb: number;
  elapsed: string;
  command: string;
  args: string;
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
      throw new BadRequestException('Perintah "ss" tidak tersedia. Install iproute2 (Debian/Ubuntu) atau iproute (Arch).');
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

    const pids = [...new Set(rows.map((row) => row.pid).filter((pid): pid is number => !!pid))];
    if (pids.length) {
      try {
        const ps = await run('ps', ['-o', 'pid=,etimes=,args=', '-p', pids.join(',')]);
        const meta = new Map<number, { etimes: number; args: string }>();
        for (const line of ps.split('\n')) {
          const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
          if (match) meta.set(Number(match[1]), { etimes: Number(match[2]), args: match[3] });
        }
        for (const row of rows) {
          const info = row.pid ? meta.get(row.pid) : undefined;
          if (!info) continue;
          row.uptimeSec = info.etimes;
          row.cmd = info.args;
          if (!row.process) row.process = info.args.split(' ')[0].split('/').pop() ?? '';
        }
      } catch {
        // proses sudah mati / tidak bisa dibaca
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

  /** Snapshot mirip htop: proses paling rakus CPU dulu + ringkasan sistem. */
  async processes(limit = 60) {
    let output: string;
    try {
      output = await run('ps', ['-eo', 'pid=,ppid=,user:16=,%cpu=,%mem=,rss=,etime=,comm=,args=', '--sort=-%cpu']);
    } catch (err) {
      throw new BadRequestException('Gagal membaca daftar proses: ' + (err as Error).message);
    }
    const rows: ProcRow[] = [];
    for (const line of output.split('\n')) {
      const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(line);
      if (!match) continue;
      rows.push({
        pid: Number(match[1]),
        ppid: Number(match[2]),
        user: match[3],
        cpu: Number(match[4]),
        mem: Number(match[5]),
        rssKb: Number(match[6]),
        elapsed: match[7],
        command: match[8],
        args: match[9],
      });
      if (rows.length >= limit) break;
    }
    return {
      rows,
      system: {
        load: loadavg().map((value) => Math.round(value * 100) / 100),
        cpus: cpus().length,
        memTotal: totalmem(),
        memFree: freemem(),
        uptime: uptime(),
      },
      generatedAt: Date.now(),
    };
  }

  /** Kirim SIGTERM. Ditolak untuk PID 1 dan proses server ini sendiri. */
  async kill(pid: number) {
    if (!Number.isInteger(pid) || pid <= 1) throw new BadRequestException('PID tidak valid');
    if (pid === process.pid) throw new BadRequestException('Tidak boleh mematikan Super Tool sendiri');
    try {
      process.kill(pid, 0);
    } catch {
      throw new BadRequestException('PID ' + pid + ' tidak ditemukan');
    }
    try {
      process.kill(pid, 'SIGTERM');
    } catch (err) {
      throw new BadRequestException('Gagal mengirim SIGTERM: ' + (err as Error).message);
    }
    return { ok: true, pid, signal: 'SIGTERM' };
  }
}
