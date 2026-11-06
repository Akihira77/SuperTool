import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Icon, cn } from '../components/ui';
import { useI18n } from '../lib/i18n';
import { buildDiff, type Diff, type Row, type Segment } from '../lib/textDiff';

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

function DiffSide({
  side,
  row,
  locked,
  onStart,
}: {
  side: 'left' | 'right';
  row: Row;
  locked: boolean;
  onStart: (side: 'left' | 'right') => void;
}) {
  const left = side === 'left';
  const lineNo = left ? row.leftNo : row.rightNo;
  const text = left ? row.left : row.right;
  const parts = left ? row.leftParts : row.rightParts;
  const removed = left && row.kind === 'removed';
  const added = !left && row.kind === 'added';
  const changed = row.kind === 'changed';

  return (
    <div
      className={cn(
        'flex min-h-6 gap-2 px-2 py-0.5',
        left && 'border-r border-line/40',
        removed ? 'bg-bad/10' : added ? 'bg-ok/10' : changed ? (left ? 'bg-warn/5' : 'bg-ok/5') : '',
        locked && 'select-none',
      )}
      onMouseDown={() => onStart(side)}
    >
      <span className="mono w-8 shrink-0 select-none text-right text-[10px] leading-5 text-muted/45">
        {lineNo ?? ''}
      </span>
      <div className="min-w-0 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-5">
        <Segments parts={parts} fallback={text ?? ''} />
      </div>
    </div>
  );
}

function InputPane({
  label,
  placeholder,
  value,
  onChange,
  textareaRef,
  height,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  height: number;
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
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        spellCheck={false}
        style={{ height }}
        className="block w-full resize-y bg-transparent p-3 font-mono text-[12px] leading-5 outline-none placeholder:text-muted/50"
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
  const [selecting, setSelecting] = useState<'left' | 'right' | null>(null);
  const [editorHeight, setEditorHeight] = useState(224);
  const leftRef = useRef<HTMLTextAreaElement>(null);
  const rightRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const elements = [leftRef.current, rightRef.current].filter(
      (element): element is HTMLTextAreaElement => element !== null,
    );
    if (!elements.length || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const target = entries[0]?.target as HTMLTextAreaElement | undefined;
      if (!target) return;
      const height = Math.round(target.getBoundingClientRect().height);
      if (height < 24) return;
      setEditorHeight((current) => (Math.abs(current - height) < 1 ? current : height));
    });
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const clear = () => setSelecting(null);
    window.addEventListener('mouseup', clear);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('mouseup', clear);
      window.removeEventListener('blur', clear);
    };
  }, []);

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
            textareaRef={leftRef}
            height={editorHeight}
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
            textareaRef={rightRef}
            height={editorHeight}
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
                      <DiffSide
                        side="left"
                        row={row}
                        locked={selecting === 'right'}
                        onStart={setSelecting}
                      />
                      <DiffSide
                        side="right"
                        row={row}
                        locked={selecting === 'left'}
                        onStart={setSelecting}
                      />
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
