import { BadRequestException } from '@nestjs/common';
import { copyFile, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { buildZip, entryText, readZip, replaceEntry, type ZipItem } from './zip';

/**
 * Pratinjau + edit teks OOXML tanpa dependensi.
 * docx: paragraf teks bisa diedit (1:1). xlsx: nilai sel bisa diedit.
 * pptx/odt/ods/odp: pratinjau saja.
 */
export type Block =
  | { type: 'text'; lines: string[] }
  | { type: 'table'; name?: string; rows: string[][]; refs?: string[][] };
export type OfficePreview = { kind: string; blocks: Block[]; editable: 'text' | 'sheet' | 'none'; truncated: boolean };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (all, name) => ENTITIES[String(name).toLowerCase()] ?? all);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripTags(xml: string): string {
  return decode(xml.replace(/<[^>]+>/g, ''));
}

// ---------- docx ----------

type RunRef = { start: number; end: number; raw: string };
type Para = { runs: RunRef[]; text: string };

function docxParagraphs(xml: string): Para[] {
  const runs: RunRef[] = [];
  const runRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let match: RegExpExecArray | null;
  while ((match = runRe.exec(xml))) {
    const start = match.index + match[0].indexOf('>') + 1;
    runs.push({ start, end: start + match[1].length, raw: match[1] });
  }

  const paras: Para[] = [];
  let from = 0;
  const endRe = /<\/w:p>/g;
  let endMatch: RegExpExecArray | null;
  let runIndex = 0;
  while ((endMatch = endRe.exec(xml)) && paras.length < 5000) {
    const to = endMatch.index;
    const inside: RunRef[] = [];
    while (runIndex < runs.length && runs[runIndex].start < to) {
      if (runs[runIndex].start >= from) inside.push(runs[runIndex]);
      runIndex += 1;
    }
    if (inside.length) paras.push({ runs: inside, text: inside.map((run) => decode(run.raw)).join('') });
    from = to;
  }
  return paras;
}

function applyDocxTexts(xml: string, texts: string[]): string {
  const paras = docxParagraphs(xml);
  if (texts.length !== paras.length) {
    throw new BadRequestException(
      'Jumlah paragraf harus sama dengan dokumen (' + paras.length + '). Menambah/menghapus paragraf belum didukung.',
    );
  }
  const edits: Array<{ start: number; end: number; value: string }> = [];
  paras.forEach((para, index) => {
    const next = texts[index] ?? '';
    if (next === para.text) return;
    para.runs.forEach((run, runIdx) => {
      edits.push({ start: run.start, end: run.end, value: runIdx === 0 ? escapeXml(next) : '' });
    });
  });
  edits.sort((a, b) => b.start - a.start);
  let out = xml;
  for (const edit of edits) out = out.slice(0, edit.start) + edit.value + out.slice(edit.end);
  return out;
}

// ---------- xlsx ----------

type CellRef = { ref: string; start: number; end: number; attrs: string; body: string };

function sheetCells(xml: string): CellRef[] {
  const cells: CellRef[] = [];
  const re = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    cells.push({ ref: match[1], start: match.index, end: match.index + match[0].length, attrs: match[2] ?? '', body: match[3] ?? '' });
  }
  return cells;
}

function cellValue(attrs: string, body: string, strings: string[]): string {
  const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? '';
  if (type === 's') {
    const index = Number(/<v>(\d+)<\/v>/.exec(body)?.[1] ?? -1);
    return strings[index] ?? '';
  }
  if (type === 'inlineStr') {
    const inner = /<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? body;
    return [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');
  }
  return decode(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '').trim();
}

function columnIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase();
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return Math.max(0, index - 1);
}

function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((inner) => decode(inner[1])).join(''),
  );
}

function sheetGrid(xml: string, strings: string[]): { rows: string[][]; refs: string[][] } {
  const cells = sheetCells(xml);
  const byRef = new Map(cells.map((cell) => [cell.ref, cell]));
  const rows: string[][] = [];
  const refs: string[][] = [];
  const rowRe = /<row[^>]*r="(\d+)"[\s\S]*?<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(xml)) && rows.length < 400) {
    const rowNumber = Number(rowMatch[1]);
    const cellsInRow = [...rowMatch[0].matchAll(/<c r="([A-Z]+)\d+"/g)].map((m) => m[1]);
    if (!cellsInRow.length) continue;
    const line: string[] = [];
    const lineRefs: string[] = [];
    for (const column of cellsInRow) {
      const ref = column + rowNumber;
      const cell = byRef.get(ref);
      const at = columnIndex(ref);
      while (line.length < at) {
        line.push('');
        lineRefs.push(columnFromIndex(lineRefs.length) + rowNumber);
      }
      line[at] = cell ? cellValue(cell.attrs, cell.body, strings) : '';
      lineRefs[at] = ref;
    }
    rows.push(line);
    refs.push(lineRefs);
  }
  return { rows, refs };
}

function columnFromIndex(index: number): string {
  let value = index + 1;
  let out = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    out = String.fromCharCode(65 + remainder) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}

function applyCellEdits(xml: string, edits: Array<{ ref: string; value: string }>): string {
  const cells = new Map(sheetCells(xml).map((cell) => [cell.ref, cell]));
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  for (const edit of edits) {
    const cell = cells.get(edit.ref);
    if (!cell) continue;
    const style = /s="(\d+)"/.exec(cell.attrs);
    const styleAttr = style ? ' s="' + style[1] + '"' : '';
    const value = edit.value;
    if (!value) {
      replacements.push({ start: cell.start, end: cell.end, value: '<c r="' + edit.ref + '"' + styleAttr + '/>' });
      continue;
    }
    if (/^-?\d+(\.\d+)?$/.test(value.trim())) {
      replacements.push({
        start: cell.start,
        end: cell.end,
        value: '<c r="' + edit.ref + '"' + styleAttr + '><v>' + value.trim() + '</v></c>',
      });
      continue;
    }
    replacements.push({
      start: cell.start,
      end: cell.end,
      value:
        '<c r="' + edit.ref + '"' + styleAttr + ' t="inlineStr"><is><t xml:space="preserve">' + escapeXml(value) + '</t></is></c>',
    });
  }
  replacements.sort((a, b) => b.start - a.start);
  let out = xml;
  for (const item of replacements) out = out.slice(0, item.start) + item.value + out.slice(item.end);
  return out;
}

// ---------- pratinjau ----------

const TEXT_EXT = new Set(['docx']);
const SHEET_EXT = new Set(['xlsx']);
const PREVIEW_EXT = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']);

export function isOffice(path: string): boolean {
  return PREVIEW_EXT.has(extname(path).slice(1).toLowerCase());
}

export async function previewOffice(path: string): Promise<OfficePreview> {
  const kind = extname(path).slice(1).toLowerCase();
  const buffer = await readFile(path);
  if (buffer.length > 40 * 1024 * 1024) throw new BadRequestException('Berkas terlalu besar (>40 MB)');
  const items = readZip(buffer);

  if (kind === 'docx' || kind === 'odt') {
    const file = kind === 'docx' ? 'word/document.xml' : 'content.xml';
    const xml = entryText(items, file);
    const paragraphs = kind === 'docx' ? docxParagraphs(xml) : [...xml.matchAll(/<text:p(?:\s[^>]*)?>([\s\S]*?)<\/text:p>/g)].map((match) => ({ text: stripTags(match[1]) }));
    const lines = paragraphs.map((para) => para.text).slice(0, 4000);
    return {
      kind,
      blocks: lines.length ? [{ type: 'text', lines }] : [],
      editable: TEXT_EXT.has(kind) ? 'text' : 'none',
      truncated: paragraphs.length > 4000,
    };
  }

  if (kind === 'xlsx' || kind === 'ods') {
    const workbook = entryText(items, 'xl/workbook.xml');
    const names = [...workbook.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map((match) => decode(match[1]));
    const blocks: Block[] = [];
    if (kind === 'xlsx') {
      const strings = sharedStrings(entryText(items, 'xl/sharedStrings.xml'));
      const sheetFiles = items
        .map((item) => item.name)
        .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
        .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
      sheetFiles.slice(0, 10).forEach((file, index) => {
        const { rows, refs } = sheetGrid(entryText(items, file), strings);
        blocks.push({ type: 'table', name: names[index] ?? 'Sheet ' + (index + 1), rows, refs });
      });
    } else {
      const content = entryText(items, 'content.xml');
      const rows = [...content.matchAll(/<table:table-row[\s\S]*?<\/table:table-row>/g)]
        .slice(0, 400)
        .map((row) =>
          [...row[0].matchAll(/<table:table-cell[\s\S]*?<\/table:table-cell>/g)].map((cell) => stripTags(cell[0]).trim()),
        );
      blocks.push({ type: 'table', name: names[0] ?? 'Sheet 1', rows });
    }
    return { kind, blocks, editable: SHEET_EXT.has(kind) ? 'sheet' : 'none', truncated: false };
  }

  const blocks: Block[] = [];
  if (kind === 'pptx') {
    const slideFiles = items
      .map((item) => item.name)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
    slideFiles.slice(0, 60).forEach((file, index) => {
      const xml = entryText(items, file);
      const lines = [...xml.matchAll(/<a:p[\s\S]*?<\/a:p>/g)]
        .map((para) => [...para[0].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) => decode(m[1])).join('').trim())
        .filter(Boolean);
      blocks.push({ type: 'text', lines: ['Slide ' + (index + 1), ...(lines.length ? lines : ['(kosong)'])] });
    });
    return { kind, blocks, editable: 'none', truncated: slideFiles.length > 60 };
  }

  const content = entryText(items, 'content.xml');
  const lines = [...content.matchAll(/<text:p(?:\s[^>]*)?>([\s\S]*?)<\/text:p>/g)].map((match) => stripTags(match[1])).filter(Boolean);
  return { kind, blocks: lines.length ? [{ type: 'text', lines: lines.slice(0, 400) }] : [], editable: 'none', truncated: lines.length > 400 };
}

/** Simpan hasil edit: teks paragraf (docx) atau nilai sel (xlsx). */
export async function saveOfficeEdits(
  path: string,
  patch: { texts?: string[]; cells?: Array<{ sheet: number; ref: string; value: string }> },
): Promise<{ ok: true; backup: string }> {
  const kind = extname(path).slice(1).toLowerCase();
  if (!TEXT_EXT.has(kind) && !SHEET_EXT.has(kind)) {
    throw new BadRequestException('Format ini hanya bisa dibaca, belum bisa diedit');
  }
  const buffer = await readFile(path);
  let items: ZipItem[] = readZip(buffer);

  if (kind === 'docx') {
    const texts = patch.texts;
    if (!Array.isArray(texts)) throw new BadRequestException('Tidak ada teks untuk disimpan');
    const file = 'word/document.xml';
    const xml = entryText(items, file);
    items = replaceEntry(items, file, Buffer.from(applyDocxTexts(xml, texts), 'utf8'));
  } else {
    const cells = patch.cells ?? [];
    if (!cells.length) throw new BadRequestException('Tidak ada sel yang diubah');
    const sheetFiles = items
      .map((item) => item.name)
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
    const bySheet = new Map<number, Array<{ ref: string; value: string }>>();
    for (const cell of cells) {
      const key = Number(cell.sheet) || 0;
      if (!bySheet.has(key)) bySheet.set(key, []);
      bySheet.get(key)!.push({ ref: String(cell.ref).toUpperCase(), value: String(cell.value ?? '') });
    }
    for (const [sheet, edits] of bySheet) {
      const file = sheetFiles[sheet];
      if (!file) continue;
      const xml = entryText(items, file);
      items = replaceEntry(items, file, Buffer.from(applyCellEdits(xml, edits), 'utf8'));
    }
  }

  // Cadangan sebelum menimpa: <nama>_backup_<timestamp>.<ext>
  const backup = await backupPath(path);
  await copyFile(path, backup);
  await pruneBackups(path, 5);

  await writeFile(path, buildZip(items));
  return { ok: true, backup };
}

function stamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    '-' +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

async function backupPath(path: string): Promise<string> {
  const ext = extname(path);
  const base = basename(path, ext);
  return join(dirname(path), base + '_backup_' + stamp() + ext);
}

/** Simpan maksimal 5 cadangan terbaru per berkas. */
async function pruneBackups(path: string, keep: number): Promise<void> {
  const ext = extname(path);
  const base = basename(path, ext);
  const prefix = base + '_backup_';
  const dir = dirname(path);
  try {
    const names = (await readdir(dir))
      .filter((name) => name.startsWith(prefix) && name.endsWith(ext))
      .sort();
    for (const name of names.slice(0, Math.max(0, names.length - keep))) {
      await rm(join(dir, name), { force: true });
    }
  } catch {
    // abaikan: pemangkasan cadangan bukan hal kritis
  }
}
