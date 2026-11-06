import { useMemo, useState } from 'react';
import { Icon, cn } from '../components/ui';
import { useI18n } from '../lib/i18n';
import { buildDiff, type Diff, type Segment } from '../lib/textDiff';

function Segments({ parts, fallback }: { parts?: Segment[]; fallback: string }) {
  if (!parts) return <>{fallback}</>;
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === 'same') return <span key={index}>{part.text}</span>;
        const removed = part.kind === 'removed';
        return (
          <mark
            key={index}
            className={cn('rounded-[2px] px-0.5', removed ? 'bg-bad/20 text-bad' : 'bg-ok/15 text-ok')}
          >
            {part.text}
          </mark>
        );
      })}
    </>
  );
}

function InputPane({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const lines = value ? value.split(/\r\n?|\n/).length : 0;
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-[11.5px] font-medium">{label}</span>
        <span className="mono text-[10.5px] text-muted">{lines} {t('compare.lines')}</span>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        spellCheck={false}
        className="block h-56 w-full resize-y bg-transparent p-3 font-mono text-[12px] leading-5 outline-none placeholder:text-muted/50"
      />
    </div>
  );
}

export default function TextCompare() {
  const { t } = useI18n();
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState('');

  const stats = useMemo(() => {
    const counts = { same: 0, changed: 0, added: 0, removed: 0 };
    for (const row of diff?.rows ?? []) counts[row.kind] += 1;
    return counts;
  }, [diff]);

  const run = () => {
    setError('');
    const result = buildDiff(left, right);
    if (result.tooLarge) {
      setDiff(null);
      setError(t('compare.tooLarge'));
      return;
    }
    setDiff(result);
  };

  const clear = () => {
    setLeft('');
    setRight('');
    setDiff(null);
    setError('');
  };

  const swap = () => {
    setLeft(right);
    setRight(left);
    setDiff(null);
    setError('');
  };

  const empty = !left && !right;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 md:p-5">
      <div className="mx-auto w-full max-w-6xl space-y-3">
        <div className="grid gap-3 lg:grid-cols-2">
          <InputPane
            label={t('compare.left')}
            placeholder={t('compare.leftPlaceholder')}
            value={left}
            onChange={(value) => {
              setLeft(value);
              setDiff(null);
              setError('');
            }}
          />
          <InputPane
            label={t('compare.right')}
            placeholder={t('compare.rightPlaceholder')}
            value={right}
            onChange={(value) => {
              setRight(value);
              setDiff(null);
              setError('');
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" onClick={run} disabled={empty}>
            <Icon name="search" size={13} /> {t('compare.compare')}
          </button>
          <button type="button" className="btn" onClick={swap} disabled={empty}>
            <Icon name="refresh" size={13} /> {t('compare.swap')}
          </button>
          <button type="button" className="btn" onClick={clear} disabled={empty}>
            <Icon name="trash" size={13} /> {t('compare.clear')}
          </button>
          {diff ? (
            <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-muted">
              <span className="rounded bg-panel2 px-1.5 py-0.5">{stats.same} {t('compare.same')}</span>
              <span className="rounded bg-warn/10 px-1.5 py-0.5 text-warn">{stats.changed} {t('compare.changed')}</span>
              <span className="rounded bg-ok/10 px-1.5 py-0.5 text-ok">{stats.added} {t('compare.added')}</span>
              <span className="rounded bg-bad/10 px-1.5 py-0.5 text-bad">{stats.removed} {t('compare.removed')}</span>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[12px] text-bad">{error}</div>
        ) : !diff ? (
          <div className="rounded-lg border border-dashed border-line bg-panel/20 px-3 py-8 text-center text-[12px] text-muted">
            {t('compare.hint')}
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="max-h-[60vh] overflow-auto">
              <div className="min-w-[560px]">
                <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-b border-line bg-panel2 text-[10.5px] font-medium text-muted">
                  <div className="border-r border-line px-3 py-2">{t('compare.left')}</div>
                  <div className="px-3 py-2">{t('compare.right')}</div>
                </div>
                <div className="divide-y divide-line/40">
                  {diff.rows.map((row, index) => (
                    <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <div
                        className={cn(
                          'flex min-h-6 gap-2 border-r border-line/40 px-2 py-0.5',
                          row.kind === 'removed' ? 'bg-bad/10' : row.kind === 'changed' ? 'bg-warn/5' : '',
                        )}
                      >
                        <span className="mono w-8 shrink-0 select-none text-right text-[10px] leading-5 text-muted/45">
                          {row.leftNo ?? ''}
                        </span>
                        <div className="min-w-0 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-5">
                          <Segments parts={row.leftParts} fallback={row.left ?? ''} />
                        </div>
                      </div>
                      <div
                        className={cn(
                          'flex min-h-6 gap-2 px-2 py-0.5',
                          row.kind === 'added' ? 'bg-ok/10' : row.kind === 'changed' ? 'bg-ok/5' : '',
                        )}
                      >
                        <span className="mono w-8 shrink-0 select-none text-right text-[10px] leading-5 text-muted/45">
                          {row.rightNo ?? ''}
                        </span>
                        <div className="min-w-0 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-5">
                          <Segments parts={row.rightParts} fallback={row.right ?? ''} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
