import { useMemo, useState } from 'react';
import { cn } from '../../components/ui';

const FLAGS = ['g', 'i', 'm', 's', 'u'] as const;

type Hit = { index: number; text: string; groups: string[] };

export default function RegexTab() {
  const [pattern, setPattern] = useState('(\\w+)@(\\w+)\\.com');
  const [flags, setFlags] = useState<string[]>(['g']);
  const [text, setText] = useState('hubungi budi@mail.com dan sari@kerja.id');
  const [replacement, setReplacement] = useState('[email]');

  const result = useMemo(() => {
    if (!pattern) return { hits: [] as Hit[], error: '' };
    try {
      const regex = new RegExp(pattern, flags.includes('g') ? flags.join('') : flags.join('') + 'g');
      const hits: Hit[] = [];
      let match: RegExpExecArray | null;
      let guard = 0;
      while ((match = regex.exec(text)) && guard < 500) {
        guard += 1;
        hits.push({ index: match.index, text: match[0], groups: match.slice(1).map((group) => String(group ?? '')) });
        if (!regex.global || match[0] === '') regex.lastIndex += 1;
      }
      const single = new RegExp(pattern, flags.join('').replace('g', ''));
      return { hits, error: '', replaced: text.replace(single, replacement) };
    } catch (err) {
      return { hits: [] as Hit[], error: (err as Error).message };
    }
  }, [pattern, flags, text, replacement]);

  const segments = useMemo(() => {
    if (!result.hits.length) return [{ text, hit: false }];
    const parts: Array<{ text: string; hit: boolean }> = [];
    let cursor = 0;
    for (const hit of result.hits) {
      if (hit.index > cursor) parts.push({ text: text.slice(cursor, hit.index), hit: false });
      parts.push({ text: hit.text, hit: true });
      cursor = hit.index + hit.text.length;
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
    return parts;
  }, [result.hits, text]);

  return (
    <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-4 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] tracking-wide text-muted uppercase">Pattern</span>
          <input value={pattern} onChange={(event) => setPattern(event.target.value)} className="input mono" spellCheck={false} />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          {FLAGS.map((flag) => (
            <button
              key={flag}
              type="button"
              onClick={() => setFlags(flags.includes(flag) ? flags.filter((item) => item !== flag) : [...flags, flag])}
              className={cn('chip cursor-pointer', flags.includes(flag) && 'border-accent/60 bg-accent/15 text-accent')}
            >
              {flag}
            </button>
          ))}
          <span className={cn('text-[11.5px]', result.error ? 'text-bad' : 'text-muted')}>
            {result.error || result.hits.length + ' kecocokan'}
          </span>
        </div>

        <label className="flex min-h-0 flex-1 flex-col gap-1">
          <span className="text-[11px] tracking-wide text-muted uppercase">Teks uji</span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            className="input mono min-h-[220px] flex-1 resize-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] tracking-wide text-muted uppercase">Ganti dengan</span>
          <input value={replacement} onChange={(event) => setReplacement(event.target.value)} className="input mono" spellCheck={false} />
        </label>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] tracking-wide text-muted uppercase">Sorotan</span>
          <pre className="mono min-h-24 whitespace-pre-wrap rounded-lg border border-line bg-[#0b1118] p-3 text-[12.5px] leading-relaxed">
            {segments.map((segment, index) =>
              segment.hit ? (
                <mark key={index} className="rounded bg-accent/30 px-0.5 text-ink">
                  {segment.text}
                </mark>
              ) : (
                <span key={index}>{segment.text}</span>
              ),
            )}
          </pre>
        </div>

        <div className="flex min-h-0 flex-col gap-1">
          <span className="text-[11px] tracking-wide text-muted uppercase">Grup</span>
          <div className="max-h-64 overflow-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-[12px]">
              <tbody>
                {result.hits.map((hit, index) => (
                  <tr key={index} className="border-b border-line/60 last:border-0">
                    <td className="mono px-2 py-1 text-muted">#{index + 1}</td>
                    <td className="mono px-2 py-1 text-ink">{hit.text}</td>
                    <td className="mono px-2 py-1 text-muted">{hit.groups.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[11px] tracking-wide text-muted uppercase">Hasil replace</span>
          <pre className="mono max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-[#0b1118] p-3 text-[12.5px]">
            {result.error ? '' : result.replaced}
          </pre>
        </div>
      </div>
    </div>
  );
}
