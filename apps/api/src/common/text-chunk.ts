/** Potong buffer tepat sebelum karakter UTF-8 yang terbelah di batas chunk. */
export function utf8Cut(buffer: Buffer, end: number): number {
  let cut = Math.min(end, buffer.length);
  while (cut > 0 && ((buffer[cut] ?? 0) & 0xc0) === 0x80) cut--;
  return cut === 0 && end > 0 ? end : cut;
}
