export type FuzzyMatch = { score: number; hits: number[] };

/**
 * Pencocokan ringan ala command palette: substring diutamakan, lalu
 * subsequence dengan bonus untuk karakter berurutan dan awal kata.
 */
export function fuzzyMatch(text: string, query: string): FuzzyMatch | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return { score: 0, hits: [] };
  const haystack = text.toLowerCase();
  const direct = haystack.indexOf(needle);
  if (direct >= 0) {
    const boundary = direct === 0 || /[\s._/-]/.test(haystack[direct - 1]) ? 24 : 0;
    return { score: 1000 + boundary - direct, hits: Array.from({ length: needle.length }, (_, index) => direct + index) };
  }

  const hits: number[] = [];
  let cursor = 0;
  let score = 100;
  let previous = -2;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found < 0) return null;
    hits.push(found);
    if (found === previous + 1) score += 8;
    if (found === 0 || /[\s._/-]/.test(haystack[found - 1])) score += 14;
    score -= Math.max(0, found - cursor);
    previous = found;
    cursor = found + 1;
  }
  return { score, hits };
}

export function splitHighlight(text: string, hits: number[]): Array<{ text: string; hit: boolean }> {
  if (!hits.length) return [{ text, hit: false }];
  const marked = new Set(hits);
  const parts: Array<{ text: string; hit: boolean }> = [];
  for (let index = 0; index < text.length; index += 1) {
    const hit = marked.has(index);
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.text += text[index];
    else parts.push({ text: text[index], hit });
  }
  return parts;
}
