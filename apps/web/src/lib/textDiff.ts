export type SegmentKind = 'same' | 'removed' | 'added';
export type Segment = { kind: SegmentKind; text: string };
export type RowKind = 'same' | 'changed' | 'removed' | 'added';
export type Row = {
  kind: RowKind;
  left?: string;
  right?: string;
  leftNo?: number;
  rightNo?: number;
  leftParts?: Segment[];
  rightParts?: Segment[];
};

export type Diff = { rows: Row[]; tooLarge?: boolean };

const MAX_LINES = 2000;
const MAX_TOKENS = 400;

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

function tokenize(line: string): string[] {
  return line.match(/\s+|\S+/g) ?? [];
}

function lcsTable(a: string[], b: string[]): Uint32Array[] {
  const table: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  return table;
}

function mergeSegments(parts: Segment[]): Segment[] {
  const merged: Segment[] = [];
  for (const part of parts) {
    if (!part.text) continue;
    const previous = merged[merged.length - 1];
    if (previous && previous.kind === part.kind) previous.text += part.text;
    else merged.push({ ...part });
  }
  return merged;
}

/** Diff per token; fallback satu blok untuk baris yang terlalu panjang. */
function wordDiff(left: string, right: string): { left: Segment[]; right: Segment[] } {
  const a = tokenize(left);
  const b = tokenize(right);
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    return { left: [{ kind: 'removed', text: left }], right: [{ kind: 'added', text: right }] };
  }

  const table = lcsTable(a, b);
  const leftParts: Segment[] = [];
  const rightParts: Segment[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      leftParts.push({ kind: 'same', text: a[i - 1] });
      rightParts.push({ kind: 'same', text: b[j - 1] });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      rightParts.push({ kind: 'added', text: b[j - 1] });
      j -= 1;
    } else {
      leftParts.push({ kind: 'removed', text: a[i - 1] });
      i -= 1;
    }
  }

  return { left: mergeSegments(leftParts.reverse()), right: mergeSegments(rightParts.reverse()) };
}

export function buildDiff(leftText: string, rightText: string): Diff {
  const left = splitLines(leftText);
  const right = splitLines(rightText);
  if (left.length > MAX_LINES || right.length > MAX_LINES) return { rows: [], tooLarge: true };

  const table = lcsTable(left, right);
  const raw: Array<{ kind: 'same' | 'removed' | 'added'; text: string; leftNo?: number; rightNo?: number }> = [];
  let i = left.length;
  let j = right.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && left[i - 1] === right[j - 1]) {
      raw.push({ kind: 'same', text: left[i - 1], leftNo: i, rightNo: j });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      raw.push({ kind: 'added', text: right[j - 1], rightNo: j });
      j -= 1;
    } else {
      raw.push({ kind: 'removed', text: left[i - 1], leftNo: i });
      i -= 1;
    }
  }
  raw.reverse();

  const rows: Row[] = [];
  for (let index = 0; index < raw.length; ) {
    const item = raw[index];
    if (item.kind === 'same') {
      rows.push({ kind: 'same', left: item.text, right: item.text, leftNo: item.leftNo, rightNo: item.rightNo });
      index += 1;
      continue;
    }

    const removed: typeof raw = [];
    const added: typeof raw = [];
    while (index < raw.length && raw[index].kind !== 'same') {
      if (raw[index].kind === 'removed') removed.push(raw[index]);
      else added.push(raw[index]);
      index += 1;
    }

    const count = Math.max(removed.length, added.length);
    for (let pair = 0; pair < count; pair += 1) {
      const leftLine = removed[pair];
      const rightLine = added[pair];
      if (leftLine && rightLine) {
        const parts = wordDiff(leftLine.text, rightLine.text);
        rows.push({
          kind: 'changed',
          left: leftLine.text,
          right: rightLine.text,
          leftNo: leftLine.leftNo,
          rightNo: rightLine.rightNo,
          leftParts: parts.left,
          rightParts: parts.right,
        });
      } else if (leftLine) {
        rows.push({ kind: 'removed', left: leftLine.text, leftNo: leftLine.leftNo });
      } else if (rightLine) {
        rows.push({ kind: 'added', right: rightLine.text, rightNo: rightLine.rightNo });
      }
    }
  }

  return { rows };
}
