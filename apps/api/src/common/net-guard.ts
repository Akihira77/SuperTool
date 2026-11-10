import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { cfg } from '../config';

type Octets = [number, number, number, number];

function ipv4Octets(address: string): Octets | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (part === '' ? NaN : Number(part)));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return octets as Octets;
}

function isPrivateIPv4(octets: Octets): boolean {
  const [a, b, c] = octets;
  // 0.0.0.0/8, 10/8, 100.64/10 (CGNAT/Tailscale), 127/8, 169.254/16 (link-local + metadata).
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  // 172.16/12, 192.0.0/24, 192.0.2/24 (dokumentasi), 192.168/16.
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 192 && b === 168) return true;
  // 198.18/15 (benchmark), 198.51.100/24, 203.0.113/24 (dokumentasi).
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  // Multicast 224/4 dan reserved 240/4 (termasuk broadcast).
  if (a >= 224) return true;
  return false;
}

function mappedIPv4(address: string): Octets | null {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (dotted) return ipv4Octets(dotted[1]);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (hex) {
    const hi = Number.parseInt(hex[1], 16);
    const lo = Number.parseInt(hex[2], 16);
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
  }
  return null;
}

const METADATA_ADDRESSES = new Set(['169.254.169.254', '169.254.170.2', '100.100.100.200', 'fd00:ec2::254']);

/** Alamat metadata cloud tetap diblokir walau link-local/privat. */
export function isMetadataAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  if (METADATA_ADDRESSES.has(ip)) return true;
  const mapped = mappedIPv4(ip);
  return mapped ? METADATA_ADDRESSES.has(mapped.join('.')) : false;
}

/** True hanya untuk alamat loopback/privat/link-local/reserved. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const family = isIP(ip);
  if (family === 4) {
    const octets = ipv4Octets(ip);
    return octets ? isPrivateIPv4(octets) : false;
  }
  if (family !== 6) return false;

  const mapped = mappedIPv4(ip);
  if (mapped) return isPrivateIPv4(mapped);
  if (ip === '::' || ip === '::1') return true;

  const first = Number.parseInt(ip.split(':')[0] || '0', 16);
  if (!Number.isFinite(first)) return false;
  // fc00::/7 (unique local), fe80::/10 (link-local), ff00::/8 (multicast).
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;
  // 2001:db8::/32 untuk dokumentasi.
  if (first === 0x2001 && /^2001:db8:/.test(ip)) return true;
  return false;
}

export type ResolvedAddress = { address: string; family: 4 | 6 };

/**
 * Resolve hostname dan kembalikan alamat pertama yang boleh dipakai.
 * Melempar BadRequestException kalau ada alamat publik ketika mode publik mati.
 * Alamat dipakai untuk pin koneksi supaya DNS rebinding tidak bisa menukar host
 * setelah pemeriksaan.
 */
export async function resolveLocalAddress(url: URL): Promise<ResolvedAddress> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return { address: '127.0.0.1', family: 4 };
  }

  const addresses: ResolvedAddress[] = [];
  if (isIP(host)) {
    addresses.push({ address: host, family: isIP(host) as 4 | 6 });
  } else {
    try {
      const results = await lookup(host, { all: true, verbatim: true });
      for (const entry of results) addresses.push({ address: entry.address, family: entry.family === 6 ? 6 : 4 });
    } catch {
      throw new BadRequestException('Host tidak bisa di-resolve: ' + host);
    }
  }
  if (!addresses.length) throw new BadRequestException('Host tidak bisa di-resolve: ' + host);

  const metadata = addresses.find((entry) => isMetadataAddress(entry.address));
  if (metadata) throw new BadRequestException('Alamat metadata cloud diblokir (' + metadata.address + ')');

  const blocked = cfg.proxyAllowPublic ? [] : addresses.filter((entry) => !isPrivateAddress(entry.address));
  if (blocked.length) {
    throw new BadRequestException(
      'Host publik diblokir (' + blocked[0].address + '). Set ST_PROXY_ALLOW_PUBLIC=1 untuk mengizinkan.',
    );
  }
  return addresses[0];
}

/** Hostname boleh kalau semua alamat hasil resolusi ada di jaringan privat. */
export async function assertLocalUrl(url: URL): Promise<void> {
  await resolveLocalAddress(url);
}
