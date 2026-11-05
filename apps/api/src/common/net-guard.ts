import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { cfg } from '../config';

function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '');
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
  if (/^127\./.test(ip)) return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  // Tailscale memakai CGNAT 100.64.0.0/10
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true;
  if (/^fe80:/i.test(ip)) return true;
  return false;
}

/** Hostname boleh kalau semua alamat hasil resolusi ada di jaringan privat. */
export async function assertLocalUrl(url: URL): Promise<void> {
  if (cfg.proxyAllowPublic) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.localdomain') || !host.includes('.')) {
    return;
  }
  const addresses: string[] = [];
  if (isIP(host)) {
    addresses.push(host);
  } else {
    try {
      const results = await lookup(host, { all: true, verbatim: true });
      for (const entry of results) addresses.push(entry.address);
    } catch {
      throw new BadRequestException('Host tidak bisa di-resolve: ' + host);
    }
  }
  if (!addresses.length) throw new BadRequestException('Host tidak bisa di-resolve: ' + host);
  const blocked = addresses.filter((address) => !isPrivateAddress(address));
  if (blocked.length) {
    throw new BadRequestException(
      'Host publik diblokir (' + blocked[0] + '). Set ST_PROXY_ALLOW_PUBLIC=1 untuk mengizinkan.',
    );
  }
}
