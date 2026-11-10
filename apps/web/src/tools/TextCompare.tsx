import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Icon, cn } from '../components/ui';
import { api, qs } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { buildDiff, type Diff, type Row, type Segment } from '../lib/textDiff';

type HistoryItem = {
  id: number;
  createdAt: number;
  leftLines: number;
  rightLines: number;
  leftPreview: string;
  rightPreview: string;
};

type HistoryPage = { items: HistoryItem[]; hasMore: boolean; nextCursor: number | null };
type HistoryDetail = HistoryItem & { leftText: string; rightText: string };

const HISTORY_PAGE_SIZE = 20;

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
      <span className="mono w-8 shrink-0 select-none text-right text-[12.5px] leading-5 text-muted/45">
        {lineNo ?? ''}
      </span>
      <div className="min-w-0 whitespace-pre-wrap break-words font-mono text-[12.5px] leading-5">
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
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useI18n();
  const lines = value ? value.split(/\r\n?|\n/).length : 0;
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-[12.5px] font-medium">{label}</span>
        <span className="mono text-[12.5px] text-muted">{lines} {t('compare.lines')}</span>
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        spellCheck={false}
        className="block h-56 w-full resize-y bg-transparent p-3 font-mono text-[13px] leading-5 outline-none placeholder:text-muted/50"
      />
    </div>
  );
}

function CompareHistory({
  items,
  loading,
  error,
  hasMore,
  activeId,
  loadingId,
  deletingId,
  saving,
  scrollRef,
  sentinelRef,
  onRefresh,
  onRetry,
  onOpen,
  onDelete,
}: {
  items: HistoryItem[];
  loading: boolean;
  error: string;
  hasMore: boolean;
  activeId: number | null;
  loadingId: number | null;
  deletingId: number | null;
  saving: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  sentinelRef: RefObject<HTMLDivElement | null>;
  onRefresh: () => void;
  onRetry: () => void;
  onOpen: (item: HistoryItem) => void;
  onDelete: (item: HistoryItem) => void;
}) {
  const { t } = useI18n();

  return (
    <aside className="min-w-0 xl:sticky xl:top-3 xl:self-start">
      <div className="card flex max-h-80 flex-col overflow-hidden xl:max-h-[calc(100vh-1.5rem)]">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Icon name="clock" size={13} className="shrink-0 text-muted" />
            <span className="truncate text-[12.5px] font-medium">{t('compare.history')}</span>
            {saving ? (
              <span className="flex shrink-0 items-center gap-1 text-[12.5px] text-muted">
                <Icon name="refresh" size={9} className="animate-spin" />
                {t('compare.saving')}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="shrink-0 rounded p-1 text-muted transition-colors hover:bg-panel2 hover:text-fg disabled:opacity-40"
            onClick={onRefresh}
            disabled={loading}
            aria-label={t('compare.refresh')}
            title={t('compare.refresh')}
          >
            <Icon name="refresh" size={11} className={cn(loading && 'animate-spin')} />
          </button>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          {error ? (
            <div className="mb-2 rounded-md border border-bad/30 bg-bad/10 px-2 py-1.5 text-[12.5px] text-bad">
              <div className="break-words">{error}</div>
              <button type="button" className="mt-1 underline underline-offset-2" onClick={onRetry}>
                {t('compare.retry')}
              </button>
            </div>
          ) : null}

          {loading && !items.length ? (
            <div className="flex items-center justify-center gap-1.5 py-6 text-[12.5px] text-muted">
              <Icon name="refresh" size={11} className="animate-spin" />
              {t('compare.historyLoading')}
            </div>
          ) : null}

          {!loading && !error && !items.length ? (
            <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12px] leading-5 text-muted">
              <div>{t('compare.historyEmpty')}</div>
              <div className="mt-1 text-[12.5px] text-muted/60">{t('compare.historyHint')}</div>
            </div>
          ) : null}

          {items.map((item) => {
            const active = item.id === activeId;
            const itemLoading = item.id === loadingId;
            const deleting = item.id === deletingId;
            return (
              <div
                key={item.id}
                className={cn(
                  'group relative mb-1.5 rounded-lg border transition-colors',
                  active
                    ? 'border-accent/50 bg-accent/5'
                    : 'border-line/60 bg-panel/20 hover:border-line hover:bg-panel2/50',
                )}
              >
                <button
                  type="button"
                  className="block w-full cursor-pointer px-2.5 py-2 pr-7 text-left"
                  onClick={() => onOpen(item)}
                  disabled={itemLoading || deleting}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono truncate text-[12.5px] text-muted/70">
                      {new Date(item.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className="mono shrink-0 text-[12.5px] text-muted/55">
                      L{item.leftLines} / R{item.rightLines}
                    </span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-[12.5px] leading-4">
                    <div className="min-w-0">
                      <div className="mb-0.5 text-[12.5px] uppercase tracking-wide text-muted/50">
                        {t('compare.leftShort')}
                      </div>
                      <div className={cn('line-clamp-2 break-words text-muted', !item.leftPreview && 'italic text-muted/35')}>
                        {item.leftPreview || '—'}
                      </div>
                    </div>
                    <div className="min-w-0 border-l border-line/40 pl-1.5">
                      <div className="mb-0.5 text-[12.5px] uppercase tracking-wide text-muted/50">
                        {t('compare.rightShort')}
                      </div>
                      <div className={cn('line-clamp-2 break-words text-muted', !item.rightPreview && 'italic text-muted/35')}>
                        {item.rightPreview || '—'}
                      </div>
                    </div>
                  </div>
                  {itemLoading ? (
                    <div className="absolute inset-0 grid place-items-center rounded-lg bg-panel/70">
                      <Icon name="refresh" size={13} className="animate-spin text-accent" />
                    </div>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="absolute right-1 top-1 rounded p-1 text-muted/35 opacity-100 transition-colors hover:bg-bad/10 hover:text-bad focus:opacity-100 disabled:opacity-30 sm:opacity-0 sm:group-hover:opacity-100"
                  aria-label={t('compare.delete')}
                  title={t('compare.delete')}
                  disabled={deleting}
                  onClick={() => onDelete(item)}
                >
                  <Icon name={deleting ? 'refresh' : 'trash'} size={10} className={cn(deleting && 'animate-spin')} />
                </button>
              </div>
            );
          })}

          {loading && items.length ? (
            <div className="flex items-center justify-center gap-1.5 py-2 text-[12.5px] text-muted">
              <Icon name="refresh" size={10} className="animate-spin" />
              {t('compare.historyLoading')}
            </div>
          ) : null}

          {!loading && !error && !hasMore && items.length ? (
            <div className="py-2 text-center text-[12.5px] text-muted/45">{t('compare.endHistory')}</div>
          ) : null}

          <div ref={sentinelRef} className="h-1" />
        </div>
      </div>
    </aside>
  );
}

export default function TextCompare() {
  const { t } = useI18n();
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState('');
  const [selecting, setSelecting] = useState<'left' | 'right' | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState<number | null>(null);
  const [loadingHistoryId, setLoadingHistoryId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const leftRef = useRef<HTMLTextAreaElement>(null);
  const rightRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const historySentinelRef = useRef<HTMLDivElement>(null);
  const historyCursor = useRef<number | null>(null);
  const historyLoadingRef = useRef(false);
  const syncing = useRef(false);
  const lastHeight = useRef(0);

  useEffect(() => {
    const elements = [leftRef.current, rightRef.current].filter(
      (element): element is HTMLTextAreaElement => element !== null,
    );
    if (!elements.length || typeof ResizeObserver === 'undefined') return;

    let frame = 0;
    const syncHeight = (target: HTMLTextAreaElement) => {
      const height = Math.round(target.getBoundingClientRect().height);
      if (height < 24 || Math.abs(lastHeight.current - height) < 1) return;
      lastHeight.current = height;
      for (const element of elements) {
        if (Math.abs(element.getBoundingClientRect().height - height) >= 1) {
          element.style.height = height + 'px';
        }
      }
    };

    const observer = new ResizeObserver((entries) => {
      if (syncing.current) return;
      const target = entries
        .map((entry) => entry.target as HTMLTextAreaElement)
        .find((element) => Math.abs(element.getBoundingClientRect().height - lastHeight.current) >= 1) ??
        (entries[0]?.target as HTMLTextAreaElement | undefined);
      if (!target) return;
      syncing.current = true;
      frame = requestAnimationFrame(() => {
        syncHeight(target);
        syncing.current = false;
      });
    });
    for (const element of elements) observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
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

  const loadHistory = useCallback(
    async (reset = false): Promise<void> => {
      if (historyLoadingRef.current) return;
      historyLoadingRef.current = true;
      setHistoryLoading(true);
      setHistoryError('');
      try {
        const before = reset ? null : historyCursor.current;
        const data = await api.get<HistoryPage>(
          '/compare' + qs({ limit: HISTORY_PAGE_SIZE, before: before ?? undefined }),
        );
        setHistory((previous) => {
          const newestId = data.items[0]?.id ?? 0;
          const extra = reset && data.items.length ? previous.filter((item) => item.id > newestId) : [];
          const seen = new Set<number>();
          return [...extra, ...(reset ? [] : previous), ...data.items].filter((item) => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          });
        });
        historyCursor.current = data.nextCursor;
        setHistoryHasMore(data.hasMore);
      } catch (err) {
        setHistoryError(err instanceof Error ? err.message : t('compare.historyError'));
      } finally {
        historyLoadingRef.current = false;
        setHistoryLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void loadHistory(true);
  }, [loadHistory]);

  useEffect(() => {
    const target = historySentinelRef.current;
    const root = historyScrollRef.current;
    if (!target || !root || !historyHasMore || historyLoading || historyError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadHistory(false);
      },
      { root, rootMargin: '180px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [historyHasMore, historyLoading, historyError, loadHistory]);

  const saveHistory = async (leftText: string, rightText: string): Promise<void> => {
    setSaving(true);
    try {
      const item = await api.post<HistoryItem>('/compare', { left: leftText, right: rightText });
      setHistory((previous) => [item, ...previous.filter((entry) => entry.id !== item.id)]);
      setActiveHistoryId(item.id);
      setHistoryError('');
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : t('compare.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const openHistory = async (item: HistoryItem): Promise<void> => {
    if (loadingHistoryId !== null) return;
    setLoadingHistoryId(item.id);
    setHistoryError('');
    try {
      const detail = await api.get<HistoryDetail>('/compare/' + item.id);
      setLeft(detail.leftText);
      setRight(detail.rightText);
      const result = buildDiff(detail.leftText, detail.rightText);
      if (result.tooLarge) {
        setDiff(null);
        setError(t('compare.tooLarge'));
      } else {
        setDiff(result);
        setError('');
      }
      setActiveHistoryId(item.id);
      requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : t('compare.loadItemFailed'));
    } finally {
      setLoadingHistoryId(null);
    }
  };

  const deleteHistory = async (item: HistoryItem): Promise<void> => {
    if (!window.confirm(t('compare.deleteConfirm'))) return;
    setDeletingId(item.id);
    try {
      await api.del('/compare/' + item.id);
      setHistory((previous) => previous.filter((entry) => entry.id !== item.id));
      if (activeHistoryId === item.id) setActiveHistoryId(null);
      setHistoryError('');
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : t('compare.deleteFailed'));
    } finally {
      setDeletingId(null);
    }
  };

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
    void saveHistory(left, right);
  };

  const clear = () => {
    setLeft('');
    setRight('');
    setDiff(null);
    setError('');
    setActiveHistoryId(null);
  };

  const swap = () => {
    setLeft(right);
    setRight(left);
    setDiff(null);
    setError('');
    setActiveHistoryId(null);
  };

  const empty = !left && !right;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 md:p-5">
      <div className="mx-auto grid w-full max-w-7xl gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div ref={editorRef} className="min-w-0 space-y-3">
          <div className="grid gap-3 lg:grid-cols-2">
          <InputPane
            label={t('compare.left')}
            placeholder={t('compare.leftPlaceholder')}
            value={left}
            onChange={(value) => {
              setLeft(value);
              setDiff(null);
              setError('');
              setActiveHistoryId(null);
            }}
            textareaRef={leftRef}
          />
          <InputPane
            label={t('compare.right')}
            placeholder={t('compare.rightPlaceholder')}
            value={right}
            onChange={(value) => {
              setRight(value);
              setDiff(null);
              setError('');
              setActiveHistoryId(null);
            }}
            textareaRef={rightRef}
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
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              <span className="rounded bg-panel2 px-1.5 py-0.5">{stats.same} {t('compare.same')}</span>
              <span className="rounded bg-warn/10 px-1.5 py-0.5 text-warn">{stats.changed} {t('compare.changed')}</span>
              <span className="rounded bg-ok/10 px-1.5 py-0.5 text-ok">{stats.added} {t('compare.added')}</span>
              <span className="rounded bg-bad/10 px-1.5 py-0.5 text-bad">{stats.removed} {t('compare.removed')}</span>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[13px] text-bad">{error}</div>
        ) : !diff ? (
          <div className="rounded-lg border border-dashed border-line bg-panel/20 px-3 py-8 text-center text-[13px] text-muted">
            {t('compare.hint')}
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="max-h-[60vh] overflow-auto">
              <div className="min-w-[560px]">
                <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-b border-line bg-panel2 text-[12.5px] font-medium text-muted">
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

        <CompareHistory
          items={history}
          loading={historyLoading}
          error={historyError}
          hasMore={historyHasMore}
          activeId={activeHistoryId}
          loadingId={loadingHistoryId}
          deletingId={deletingId}
          saving={saving}
          scrollRef={historyScrollRef}
          sentinelRef={historySentinelRef}
          onRefresh={() => void loadHistory(true)}
          onRetry={() => void loadHistory(history.length === 0)}
          onOpen={(item) => void openHistory(item)}
          onDelete={(item) => void deleteHistory(item)}
        />
      </div>
    </div>
  );
}
