import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Empty, Icon, PageHeader, Spinner, cn } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useConfirm } from '../components/confirm';
import { useToast } from '../components/toast';
import { useSidebar } from '../lib/useSidebar';

type NoteMeta = { id: string; title: string; createdAt: number; updatedAt: number; snippet?: string; matches?: number };
type Note = NoteMeta & { body: string };
type SearchScope = 'all' | 'title' | 'body';

const SCOPE_OPTIONS = [
  { value: 'all', label: 'notes.searchAll' },
  { value: 'title', label: 'notes.searchTitle' },
  { value: 'body', label: 'notes.searchBody' },
] as const;

function countMatches(text: string, query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  const haystack = text.toLowerCase();
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) >= 0) {
    count += 1;
    index += needle.length;
  }
  return count;
}

/** Sorot semua kemunculan kata pencarian di potongan isi catatan. */
function Highlight({ text, query, editor = false, activeIndex }: { text: string; query: string; editor?: boolean; activeIndex?: number }) {
  const needle = query.trim();
  if (!needle) return <>{text}</>;
  const haystack = text.toLowerCase();
  const target = needle.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match = 0;
  let index = haystack.indexOf(target);
  while (index >= 0) {
    if (index > cursor) parts.push(text.slice(cursor, index));
    const current = editor && activeIndex === match;
    parts.push(
      <mark
        key={index}
        className={
          editor
            ? current
              ? 'rounded-[2px] bg-warn/50 text-transparent'
              : 'rounded-[2px] bg-accent/30 text-transparent'
            : 'rounded bg-accent/30 px-0.5 text-ink'
        }
      >
        {text.slice(index, index + needle.length)}
      </mark>,
    );
    match += 1;
    cursor = index + needle.length;
    index = haystack.indexOf(target, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

type Status = 'idle' | 'saving' | 'saved' | 'error';

export default function NotesTool() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const toast = useToast();
  const [panelOpen, togglePanel] = useSidebar('notes', true);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [active, setActive] = useState<Note | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const [scopeOpen, setScopeOpen] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);
  const [jumpTick, setJumpTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  const searchStarted = useRef(false);
  const scopeRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const bodyMatchCount = useMemo(
    () => (active && query.trim() && scope !== 'title' ? countMatches(active.body, query) : 0),
    [active, query, scope],
  );
  const activeMatch = bodyMatchCount ? matchIndex % bodyMatchCount : 0;

  const open = useCallback(async (id: string) => {
    const note = await api.get<Note>('/notes/' + id);
    setActive(note);
    setStatus('idle');
  }, []);

  const fetchNotes = useCallback(async (q: string, searchScope: SearchScope) => {
    const params = new URLSearchParams();
    if (q.trim()) {
      params.set('q', q.trim());
      params.set('scope', searchScope);
    }
    const suffix = params.toString();
    const list = await api.get<NoteMeta[]>('/notes' + (suffix ? '?' + suffix : ''));
    setNotes(list);
    return list;
  }, []);

  useEffect(() => {
    fetchNotes('', 'all')
      .then((list) => (list.length ? open(list[0].id) : null))
      .catch(() => setStatus('error'))
      .finally(() => setLoading(false));
  }, [fetchNotes, open]);

  useEffect(() => {
    if (!searchStarted.current) {
      searchStarted.current = true;
      return;
    }
    const id = window.setTimeout(() => {
      fetchNotes(query, scope).catch(() => setStatus('error'));
    }, 250);
    return () => window.clearTimeout(id);
  }, [fetchNotes, query, scope]);

  const syncHighlight = useCallback(() => {
    const textarea = textareaRef.current;
    const layer = highlightRef.current;
    if (!textarea || !layer) return;
    layer.style.width = textarea.clientWidth + 'px';
    layer.style.height = textarea.clientHeight + 'px';
    layer.scrollTop = textarea.scrollTop;
    layer.scrollLeft = textarea.scrollLeft;
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    syncHighlight();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncHighlight);
    observer?.observe(textarea);
    return () => observer?.disconnect();
  }, [active?.id, query, scope, syncHighlight]);

  useEffect(() => {
    setMatchIndex(0);
  }, [active?.id, query, scope]);

  useEffect(() => {
    if (!jumpTick || !bodyMatchCount) return;
    const textarea = textareaRef.current;
    const layer = highlightRef.current;
    const mark = layer?.querySelectorAll('mark')[activeMatch] as HTMLElement | undefined;
    if (!textarea || !layer || !mark) return;
    const markRect = mark.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    const top = markRect.top - layerRect.top + layer.scrollTop;
    const target = Math.min(
      Math.max(0, textarea.scrollHeight - textarea.clientHeight),
      Math.max(0, top - textarea.clientHeight / 2 + markRect.height / 2),
    );
    textarea.scrollTop = target;
    syncHighlight();
  }, [jumpTick, activeMatch, bodyMatchCount, syncHighlight]);

  useEffect(() => {
    if (!scopeOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!scopeRef.current?.contains(event.target as Node)) setScopeOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setScopeOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [scopeOpen]);

  const save = useCallback((note: Note) => {
    setStatus('saving');
    api
      .put('/notes/' + note.id, { title: note.title, body: note.body })
      .then(() => setStatus('saved'))
      .catch(() => setStatus('error'));
  }, []);

  const patch = (partial: Partial<Pick<Note, 'title' | 'body'>>) => {
    if (!active) return;
    const next = { ...active, ...partial };
    setActive(next);
    setNotes((prev) => prev.map((item) => (item.id === next.id ? { ...item, title: next.title, updatedAt: Date.now() } : item)));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save(next), 600);
  };

  const create = async () => {
    const note = await api.post<Note>('/notes', { title: t('notes.newTitle'), body: '' });
    toast(t('common.created'), 'ok');
    await fetchNotes(query, scope);
    setActive(note);
    setStatus('idle');
  };

  const remove = async (id: string) => {
    const ok = await confirm({ title: t('notes.confirmDelete'), danger: true, confirmLabel: t('common.delete') });
    if (!ok) return;
    await api.del('/notes/' + id);
    toast(t('common.deleted'), 'ok');
    const list = await fetchNotes(query, scope);
    if (active?.id === id) {
      if (list.length) await open(list[0].id);
      else setActive(null);
    }
  };

  const jumpNext = () => {
    if (!bodyMatchCount) return;
    setMatchIndex((prev) => (prev + 1) % bodyMatchCount);
    setJumpTick((prev) => prev + 1);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={t('notes.title')}
        icon="notes"
        subtitle={
          status === 'saving' ? t('notes.saving') : status === 'error' ? t('err.save') : status === 'saved' ? t('notes.saved') : notes.length + ' ' + t('notes.count')
        }
      >
        <button type="button" className="btn" data-action="notes:list" onClick={togglePanel} title={panelOpen ? 'Sembunyikan daftar' : 'Tampilkan daftar'}>
          <Icon name="panel" />
        </button>
        <button type="button" className="btn btn-primary" data-action="notes:new" onClick={create}>
          <Icon name="plus" /> {t('notes.new')}
        </button>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        {panelOpen ? (
        <div className="flex w-64 shrink-0 flex-col border-r border-line bg-panel/25">
          <div className="flex flex-col gap-1.5 p-2.5">
            <div className="relative">
              <Icon name="search" className="absolute top-2.5 left-2.5 text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("notes.search")} data-action="notes:search" className="input py-1.5 pl-8 text-[13px]" />
            </div>
            <div ref={scopeRef} className="relative">
              <button
                type="button"
                onClick={() => setScopeOpen((prev) => !prev)}
                aria-haspopup="listbox"
                aria-expanded={scopeOpen}
                aria-label={t('notes.searchScope')}
                className="input flex cursor-pointer items-center gap-1.5 py-1 text-left text-[11.5px]"
              >
                <Icon name="filter" size={12} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">{t(SCOPE_OPTIONS.find((item) => item.value === scope)?.label ?? 'notes.searchAll')}</span>
                <Icon name="chevronDown" size={11} className={cn('shrink-0 text-muted transition-transform', scopeOpen && 'rotate-180')} />
              </button>
              {scopeOpen ? (
                <div role="listbox" aria-label={t('notes.searchScope')} className="absolute top-full right-0 left-0 z-30 mt-1 rounded-lg border border-line bg-panel p-1 shadow-[0_18px_50px_-18px_rgb(0_0_0/0.9)]">
                  {SCOPE_OPTIONS.map((item) => {
                    const selected = scope === item.value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          setScope(item.value);
                          setScopeOpen(false);
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[11.5px] transition-colors',
                          selected ? 'bg-accent/12 text-ink' : 'text-muted hover:bg-panel2 hover:text-ink',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{t(item.label)}</span>
                        {selected ? <Icon name="check" size={12} className="shrink-0 text-accent" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {loading ? (
              <div className="flex justify-center p-6">
                <Spinner />
              </div>
            ) : notes.length === 0 ? (
              <Empty icon="notes" text={query.trim() ? t('notes.noResults') : t('notes.none')} />
            ) : (
              notes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => open(note.id)}
                  className={cn(
                    'mb-0.5 block w-full rounded-lg px-2.5 py-2 text-left transition-colors',
                    active?.id === note.id ? 'bg-accent/12' : 'hover:bg-panel2',
                  )}
                >
                  <div className="truncate text-[13px] font-medium">{note.title || 'Tanpa judul'}</div>
                  {note.snippet ? (
                    <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-muted/85">
                      <Highlight text={note.snippet} query={query} />
                    </div>
                  ) : null}
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted">{timeAgo(note.updatedAt)}</span>
                    {typeof note.matches === 'number' && note.matches > 0 ? (
                      <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[9.5px] font-medium text-accent">
                        {note.matches} {t('notes.matches')}
                      </span>
                    ) : null}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {active ? (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel/25 px-4 py-2.5">
                <input
                  value={active.title}
                  onChange={(e) => patch({ title: e.target.value })}
                  className="min-w-0 flex-1 border-0 bg-transparent px-1 text-[16px] font-semibold tracking-tight outline-none"
                  placeholder={t('notes.titlePlaceholder')}
                />
                <span
                  role="status"
                  aria-live="polite"
                  className={cn(
                    'flex shrink-0 items-center gap-1 text-[10.5px]',
                    status === 'error' ? 'text-bad' : status === 'saving' ? 'text-warn' : 'text-ok/80',
                  )}
                  title={status === 'saving' ? t('notes.saving') : status === 'error' ? t('err.save') : t('notes.autoSaved')}
                >
                  {status === 'saving' ? <Spinner /> : <Icon name={status === 'error' ? 'bell' : 'check'} size={11} />}
                  <span className="hidden sm:inline">
                    {status === 'saving' ? t('notes.saving') : status === 'error' ? t('err.save') : t('notes.autoSaved')}
                  </span>
                </span>
                <span className="text-[11px] text-muted">{active.body.length} {t('notes.characters')}</span>
                {bodyMatchCount ? (
                  <div className="flex shrink-0 items-center gap-1 rounded-md border border-line bg-panel2/50 px-1.5 py-0.5">
                    <span className="mono text-[10.5px] tabular-nums text-muted">
                      {activeMatch + 1}/{bodyMatchCount}
                    </span>
                    <button
                      type="button"
                      data-action="notes:jump"
                      onClick={jumpNext}
                      className="grid size-5 cursor-pointer place-items-center rounded text-muted transition-colors hover:bg-panel2 hover:text-ink"
                      title={t('notes.jumpNext')}
                      aria-label={t('notes.jumpNext')}
                    >
                      <Icon name="chevronDown" size={11} />
                    </button>
                  </div>
                ) : null}
                <button type="button" className="btn btn-danger" data-action="notes:delete" onClick={() => remove(active.id)} title={t("common.delete")}>
                  <Icon name="trash" />
                </button>
              </div>
              <div className="relative min-h-0 flex-1">
                {query.trim() && scope !== 'title' ? (
                  <div
                    ref={highlightRef}
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 left-0 w-full overflow-hidden p-5 text-[14px] leading-7 break-words whitespace-pre-wrap text-transparent md:p-6"
                  >
                    <Highlight text={active.body} query={query} editor activeIndex={activeMatch} />
                  </div>
                ) : null}
                <textarea
                  ref={textareaRef}
                  value={active.body}
                  onChange={(e) => patch({ body: e.target.value })}
                  onScroll={syncHighlight}
                  placeholder={t('notes.bodyPlaceholder')}
                  spellCheck={false}
                  className="relative block h-full w-full resize-none bg-transparent p-5 text-[14px] leading-7 break-words outline-none placeholder:text-muted/50 md:p-6"
                />
              </div>
            </>
          ) : (
            <Empty icon="notes" text={t('notes.empty')} />
          )}
        </div>
      </div>
    </div>
  );
}
