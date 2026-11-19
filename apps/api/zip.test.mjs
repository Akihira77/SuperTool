import assert from 'node:assert/strict';
import test from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import zip from './dist/modules/files/zip.js';

const { readZip, buildZip, entryText, replaceEntry } = zip;

function item(name, content, method = 8) {
  const raw = Buffer.from(content);
  const data = method === 8 ? deflateRawSync(raw, { level: 9 }) : raw;
  return {
    name,
    method,
    flags: 0,
    time: 0,
    date: 0,
    crc: crc32(raw),
    size: raw.length,
    compressedSize: data.length,
    versionMadeBy: 0x031e,
    versionNeeded: 20,
    intAttr: 0,
    extAttr: 0,
    extra: Buffer.alloc(0),
    localExtra: Buffer.alloc(0),
    comment: Buffer.alloc(0),
    data,
  };
}

test('zip: build lalu read mengembalikan entri dan isinya', () => {
  const items = [item('[Content_Types].xml', '<Types/>', 0), item('word/document.xml', '<w:t>halo</w:t>')];
  const parsed = readZip(buildZip(items));
  assert.deepEqual(parsed.map((entry) => entry.name), ['[Content_Types].xml', 'word/document.xml']);
  assert.equal(entryText(parsed, '[Content_Types].xml'), '<Types/>');
  assert.equal(entryText(parsed, 'word/document.xml'), '<w:t>halo</w:t>');
  assert.equal(entryText(parsed, 'tidak/ada.xml'), '');
});

test('zip: replaceEntry mengganti isi dan bisa dibaca lagi', () => {
  const original = readZip(buildZip([item('a.xml', 'lama'), item('b.xml', 'tetap')]));
  const replaced = replaceEntry(original, 'a.xml', Buffer.from('isi baru yang lebih panjang dari sebelumnya'));
  assert.equal(entryText(replaced, 'a.xml'), 'isi baru yang lebih panjang dari sebelumnya');
  assert.equal(entryText(replaced, 'b.xml'), 'tetap', 'entri lain tidak berubah');

  const reread = readZip(buildZip(replaced));
  assert.equal(entryText(reread, 'a.xml'), 'isi baru yang lebih panjang dari sebelumnya');
  assert.equal(entryText(reread, 'b.xml'), 'tetap');
});

test('zip: buffer bukan ZIP ditolak', () => {
  assert.throws(() => readZip(Buffer.from('ini bukan zip sama sekali')), /Bukan berkas ZIP/);
  assert.throws(() => readZip(Buffer.alloc(0)), /Bukan berkas ZIP/);
});
