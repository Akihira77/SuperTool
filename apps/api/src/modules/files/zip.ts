import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/** ZIP minimal: cukup untuk membaca & menulis ulang OOXML/ODF tanpa dependensi. */
type Buf = Buffer<ArrayBufferLike>;

export type ZipItem = {
  name: string;
  method: number;
  flags: number;
  time: number;
  date: number;
  crc: number;
  size: number;
  compressedSize: number;
  versionMadeBy: number;
  versionNeeded: number;
  intAttr: number;
  extAttr: number;
  extra: Buf;
  localExtra: Buf;
  comment: Buf;
  data: Buf;
};

const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const EOCD = 0x06054b50;

export function readZip(buffer: Buffer): ZipItem[] {
  let eocd = -1;
  const from = Math.max(0, buffer.length - 66_000);
  for (let i = buffer.length - 22; i >= from; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Bukan berkas ZIP/OOXML');

  const count = buffer.readUInt16LE(eocd + 10);
  let ptr = buffer.readUInt32LE(eocd + 16);
  const items: ZipItem[] = [];

  for (let i = 0; i < count && ptr + 46 <= buffer.length; i += 1) {
    if (buffer.readUInt32LE(ptr) !== CENTRAL) break;
    const versionMadeBy = buffer.readUInt16LE(ptr + 4);
    const versionNeeded = buffer.readUInt16LE(ptr + 6);
    const flags = buffer.readUInt16LE(ptr + 8);
    const method = buffer.readUInt16LE(ptr + 10);
    const time = buffer.readUInt16LE(ptr + 12);
    const date = buffer.readUInt16LE(ptr + 14);
    const crc = buffer.readUInt32LE(ptr + 16);
    const compressedSize = buffer.readUInt32LE(ptr + 20);
    const size = buffer.readUInt32LE(ptr + 24);
    const nameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    const intAttr = buffer.readUInt16LE(ptr + 36);
    const extAttr = buffer.readUInt32LE(ptr + 38);
    const localOffset = buffer.readUInt32LE(ptr + 42);
    const name = buffer.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    const extra = buffer.subarray(ptr + 46 + nameLen, ptr + 46 + nameLen + extraLen);
    const comment = buffer.subarray(ptr + 46 + nameLen + extraLen, ptr + 46 + nameLen + extraLen + commentLen);

    let localExtra: Buf = Buffer.alloc(0);
    let data: Buf = Buffer.alloc(0);
    if (buffer.readUInt32LE(localOffset) === LOCAL) {
      const localNameLen = buffer.readUInt16LE(localOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      localExtra = buffer.subarray(localOffset + 30 + localNameLen, dataStart);
      data = buffer.subarray(dataStart, dataStart + compressedSize);
    }

    items.push({
      name,
      method,
      flags,
      time,
      date,
      crc,
      size,
      compressedSize,
      versionMadeBy,
      versionNeeded,
      intAttr,
      extAttr,
      extra,
      localExtra,
      comment,
      data,
    });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return items;
}

export function entryText(items: ZipItem[], name: string): string {
  const item = items.find((entry) => entry.name === name);
  if (!item) return '';
  const raw = item.method === 0 ? item.data : inflateRawSync(item.data);
  return raw.toString('utf8');
}

/** Ganti isi satu entri (di-deflate ulang), lalu siap ditulis balik. */
export function replaceEntry(items: ZipItem[], name: string, content: Buffer): ZipItem[] {
  return items.map((item) => {
    if (item.name !== name) return item;
    const deflated = deflateRawSync(content, { level: 9 });
    const smaller = deflated.length < content.length;
    return {
      ...item,
      method: smaller ? 8 : 0,
      flags: item.flags & ~0x0008,
      crc: crc32(content),
      size: content.length,
      compressedSize: smaller ? deflated.length : content.length,
      data: smaller ? deflated : content,
    };
  });
}

export function buildZip(items: ZipItem[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const item of items) {
    const name = Buffer.from(item.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(item.versionNeeded, 4);
    local.writeUInt16LE(item.flags, 6);
    local.writeUInt16LE(item.method, 8);
    local.writeUInt16LE(item.time, 10);
    local.writeUInt16LE(item.date, 12);
    local.writeUInt32LE(item.crc, 14);
    local.writeUInt32LE(item.compressedSize, 18);
    local.writeUInt32LE(item.size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(item.localExtra.length, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(item.versionMadeBy, 4);
    central.writeUInt16LE(item.versionNeeded, 6);
    central.writeUInt16LE(item.flags, 8);
    central.writeUInt16LE(item.method, 10);
    central.writeUInt16LE(item.time, 12);
    central.writeUInt16LE(item.date, 14);
    central.writeUInt32LE(item.crc, 16);
    central.writeUInt32LE(item.compressedSize, 20);
    central.writeUInt32LE(item.size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(item.extra.length, 30);
    central.writeUInt16LE(item.comment.length, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(item.intAttr, 36);
    central.writeUInt32LE(item.extAttr, 38);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, item.localExtra, item.data);
    centrals.push(central, name, item.extra, item.comment);
    offset += local.length + name.length + item.localExtra.length + item.data.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, end]);
}
