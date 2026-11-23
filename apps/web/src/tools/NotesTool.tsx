import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Badge, Button, Empty, Icon, IconButton, Input, PageHeader, Select, Spinner, cn } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useConfirm } from '../components/confirm';
import { useToast } from '../components/toast';
import { useSidebar } from '../lib/useSidebar';
import { usePaletteIntent } from '../lib/palette';
import TextCompare from './TextCompare';

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
function Highlight({ text, query, editor = false, activeIndex, startMatch = 0 }: { text: string; query: string; editor?: boolean; activeIndex?: number; startMatch?: number }) {
  const needle = query.trim();
  if (!needle) return <>{text}</>;
  const haystack = text.toLowerCase();
  const target = needle.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match = startMatch;
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
  const [panelOpen, togglePanel, setPanelOpen] = useSidebar('notes', typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches);
  const [tab, setTab] = useState<'notes' | 'compare'>('notes');

  // Palette → Notes → Cari: pilih tab Notes, buka panel daftar, lalu App
  // memfokuskan input cari setelah panel benar-benar terlihat.
  usePaletteIntent('notes', (action) => {
    if (action !== 'search') return;
    setTab('notes');
    setPanelOpen(true);
  });
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [active, setActive] = useState<Note | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const [matchIndex, setMatchIndex] = useState(0);
  const [jumpTick, setJumpTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  const openSeq = useRef(0);
  const searchStarted = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const tabNotesRef = useRef<HTMLButtonElement>(null);
  const tabCompareRef = useRef<HTMLButtonElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [lineHeights, setLineHeights] = useState<number[]>([]);
  const selectTab = (next: 'notes' | 'compare') => {
    setTab(next);
    requestAnimationFrame(() => (next === 'notes' ? tabNotesRef : tabCompareRef).current?.focus());
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = event.key === 'ArrowLeft' || event.key === 'Home' ? 'notes' : event.key === 'ArrowRight' || event.key === 'End' ? 'compare' : null;
    if (!next) return;
    event.preventDefault();
    selectTab(next);
  };
  const bodyLines = useMemo(() => (active ? active.body.split('\n') : []), [active]);
  const editorQuery = scope === 'title' ? '' : query;
  const lineMatchOffsets = useMemo(() => {
    let offset = 0;
    return bodyLines.map((line) => {
      const start = offset;
      offset += editorQuery.trim() ? countMatches(line, editorQuery) : 0;
      return start;
    });
  }, [bodyLines, editorQuery]);
  const bodyMatchCount = useMemo(
    () => (active && query.trim() && scope !== 'title' ? countMatches(active.body, query) : 0),
    [active, query, scope],
  );
  const activeMatch = bodyMatchCount ? matchIndex % bodyMatchCount : 0;
  const gutterHeights = lineHeights.length === bodyLines.length ? lineHeights : bodyLines.map(() => 28);

  const open = useCallback(async (id: string) => {
    const seq = ++openSeq.current;
    const note = await api.get<Note>('/notes/' + id);
    // Klik cepat A lalu B: respons A yang datang terlambat tidak boleh menimpa B.
    if (seq !== openSeq.current) return;
    setActive(note);
    setStatus('idle');
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const close = () => { if (mq.matches) setPanelOpen(false); };
    // Jangan menutup panel saat mount: intent palette bisa baru saja membukanya
    // (termasuk di viewport sempit). Hanya perubahan viewport yang menutup panel.
    mq.addEventListener('change', close);
    return () => mq.removeEventListener('change', close);
  }, [setPanelOpen]);

  const selectNote = useCallback(async (id: string) => {
    await open(id);
    if (window.matchMedia('(max-width: 767px)').matches) setPanelOpen(false);
  }, [open, setPanelOpen]);

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
    if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop;
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    syncHighlight();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncHighlight);
    observer?.observe(textarea);
    return () => observer?.disconnect();
  }, [active?.id, query, scope, syncHighlight]);

  useLayoutEffect(() => {
    const layer = highlightRef.current;
    if (!layer) {
      setLineHeights([]);
      return;
    }
    const measure = () => {
      const next = Array.from(layer.querySelectorAll<HTMLElement>('[data-line]'), (node) => node.offsetHeight);
      setLineHeights((prev) =>
        prev.length === next.length && prev.every((height, index) => Math.abs(height - next[index]) < 0.5)
          ? prev
          : next,
      );
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(layer);
    return () => observer?.disconnect();
  }, [active?.body]);

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
    try {
      const note = await api.post<Note>('/notes', { title: t('notes.newTitle'), body: '' });
      toast(t('common.created'), 'ok');
      await fetchNotes(query, scope);
      setActive(note);
      setStatus('idle');
      // Catatan baru langsung siap diganti namanya, tanpa klik tambahan.
      requestAnimationFrame(() => {
        titleRef.current?.focus();
        titleRef.current?.select();
      });
    } catch (err) {
      setStatus('error');
      toast(err instanceof Error ? err.message : t('err.save'), 'error');
    }
  };

  const download = () => {
    if (!active) return;
    const base = (active.title || 'catatan')
      .trim()
      .replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_')
      .replace(/[. ]+$/, '')
      .slice(0, 80) || 'catatan';
    const href = URL.createObjectURL(new Blob([active.body], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = base + '.md';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  const remove = async (id: string) => {
    const ok = await confirm({ title: t('notes.confirmDelete'), danger: true, confirmLabel: t('common.delete') });
    if (!ok) return;
    try {
      await api.del('/notes/' + id);
      toast(t('common.deleted'), 'ok');
      const list = await fetchNotes(query, scope);
      if (active?.id === id) {
        if (list.length) await open(list[0].id);
        else setActive(null);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : t('err.delete'), 'error');
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
          tab === 'compare'
            ? t('compare.subtitle')
            : status === 'saving' ? t('notes.saving') : status === 'error' ? t('err.save') : status === 'saved' ? t('notes.saved') : notes.length + ' ' + t('notes.count')
        }
      >
        {tab === 'notes' ? (
          <>
            <IconButton
              icon="panel"
              size="md"
              onClick={togglePanel}
              data-action="notes:list"
              label={panelOpen ? t('notes.hideList') : t('notes.showList')}
            />
            <Button variant="primary" icon="plus" data-action="notes:new" onClick={create}>
              {t('notes.new')}
            </Button>
          </>
        ) : null}
      </PageHeader>

      <div role="tablist" aria-label={t('notes.tabs')} className="tabbar">
        <button
          ref={tabNotesRef}
          type="button"
          role="tab"
          id="notes-tab-notes"
          aria-selected={tab === 'notes'}
          aria-controls="notes-panel-notes"
          tabIndex={tab === 'notes' ? 0 : -1}
          data-action="notes:tab-notes"
          className={cn('tab', tab === 'notes' && 'tab-active')}
          onClick={() => selectTab('notes')}
          onKeyDown={onTabKeyDown}
        >
          {t('notes.tabNotes')}
        </button>
        <button
          ref={tabCompareRef}
          type="button"
          role="tab"
          id="notes-tab-compare"
          aria-selected={tab === 'compare'}
          aria-controls="notes-panel-compare"
          tabIndex={tab === 'compare' ? 0 : -1}
          data-action="notes:tab-compare"
          className={cn('tab', tab === 'compare' && 'tab-active')}
          onClick={() => selectTab('compare')}
          onKeyDown={onTabKeyDown}
        >
          {t('notes.tabCompare')}
        </button>
      </div>

      {tab === 'compare' ? (
        <div role="tabpanel" id="notes-panel-compare" aria-labelledby="notes-tab-compare" className="flex min-h-0 flex-1 flex-col">
          <TextCompare />
        </div>
      ) : (
      <div role="tabpanel" id="notes-panel-notes" aria-labelledby="notes-tab-notes" className="relative flex min-h-0 flex-1">
        {panelOpen ? (
        <div className="flex max-md:absolute max-md:inset-0 max-md:z-30 max-md:w-full max-md:bg-panel max-md:border-r-0 flex-col border-r border-line bg-panel/25 md:w-64 md:shrink-0">
          <div className="flex flex-col gap-1.5 p-2.5">
            <div className="relative">
              <Icon name="search" size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("notes.search")}
                aria-label={t("notes.search")}
                data-action="notes:search"
                className="min-h-8 py-1.5 pl-8 text-[13.5px]"
              />
            </div>
            <Select
              size="sm"
              value={scope}
              onChange={(next) => setScope(next)}
              label={t('notes.searchScope')}
              options={SCOPE_OPTIONS.map((item) => ({ value: item.value, label: t(item.label) }))}
            />
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
                  onClick={() => void selectNote(note.id)}
                  aria-current={active?.id === note.id ? 'true' : undefined}
                  className={cn(
                    'mb-0.5 block w-full rounded-panel px-2.5 py-2 text-left transition-colors duration-[var(--duration-fast)]',
                    active?.id === note.id
                      ? 'bg-accent/12 ring-1 ring-accent/25'
                      : 'hover:bg-panel2 focus-visible:bg-panel2',
                  )}
                >
                  <div className="truncate text-[13.5px] font-medium" title={note.title || t('notes.untitled')}>{note.title || t('notes.untitled')}</div>
                  {note.snippet ? (
                    <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-muted/85">
                      <Highlight text={note.snippet} query={query} />
                    </div>
                  ) : null}
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="text-[12px] text-muted tabular-nums">{timeAgo(note.updatedAt)}</span>
                    {typeof note.matches === 'number' && note.matches > 0 ? (
                      <Badge tone="accent" className="shrink-0">{note.matches} {t('notes.matches')}</Badge>
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
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel/25 px-4 py-2.5 sm:flex-nowrap">
                <input
                  ref={titleRef}
                  value={active.title}
                  onChange={(e) => patch({ title: e.target.value })}
                  className="min-w-0 basis-full border-0 bg-transparent px-1 text-[16px] font-semibold tracking-tight outline-none sm:flex-1 sm:basis-auto"
                  placeholder={t('notes.titlePlaceholder')}
                  aria-label={t('notes.titlePlaceholder')}
                />
                <span
                  role="status"
                  aria-live="polite"
                  className="flex shrink-0 items-center"
                  title={status === 'saving' ? t('notes.saving') : status === 'error' ? t('err.save') : t('notes.autoSaved')}
                >
                  <Badge tone={status === 'error' ? 'bad' : status === 'saving' ? 'warn' : 'ok'}>
                    {status === 'saving' ? <Spinner /> : <Icon name={status === 'error' ? 'bell' : 'check'} size={11} />}
                    <span className="hidden sm:inline">
                      {status === 'saving' ? t('notes.saving') : status === 'error' ? t('err.save') : t('notes.autoSaved')}
                    </span>
                  </Badge>
                </span>
                <span aria-hidden="true" className="text-muted/35">·</span>
                <span className="hidden text-[12px] text-muted tabular-nums sm:inline">{active.body.length} {t('notes.characters')}</span>
                {bodyMatchCount ? (
                  <div className="flex shrink-0 items-center gap-1 rounded-control border border-line bg-panel2/50 px-1.5 py-0.5">
                    <span className="mono text-[12.5px] tabular-nums text-muted">
                      {activeMatch + 1}/{bodyMatchCount}
                    </span>
                    <IconButton
                      icon="chevronDown"
                      size="xs"
                      data-action="notes:jump"
                      onClick={jumpNext}
                      label={t('notes.jumpNext')}
                    />
                  </div>
                ) : null}
                <IconButton
                  icon="download"
                  size="md"
                  data-action="notes:download"
                  onClick={download}
                  label={t('notes.download')}
                />
                <IconButton
                  icon="trash"
                  size="md"
                  tone="danger"
                  className="ml-0.5"
                  data-action="notes:delete"
                  onClick={() => remove(active.id)}
                  label={t('common.delete')}
                />
              </div>
              <div className="relative flex min-h-0 flex-1">
                <div
                  ref={gutterRef}
                  aria-hidden="true"
                  className="mono w-10 shrink-0 overflow-hidden border-r border-line bg-panel/20 py-5 text-right text-[12.5px] leading-7 text-muted/80 select-none md:py-6"
                >
                  {gutterHeights.map((height, index) => (
                    <div key={index} className="pr-2 tabular-nums" style={{ height }}>
                      {index + 1}
                    </div>
                  ))}
                </div>
                <div className="relative min-h-0 min-w-0 flex-1">
                  <div
                    ref={highlightRef}
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 left-0 w-full overflow-hidden p-5 text-[14px] leading-7 break-words whitespace-pre-wrap text-transparent md:p-6"
                  >
                    {bodyLines.map((line, index) => (
                      <div key={index} data-line className="min-h-7 whitespace-pre-wrap break-words">
                        <Highlight
                          text={line}
                          query={editorQuery}
                          editor
                          activeIndex={activeMatch}
                          startMatch={lineMatchOffsets[index] ?? 0}
                        />
                      </div>
                    ))}
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={active.body}
                    onChange={(e) => patch({ body: e.target.value })}
                    onScroll={syncHighlight}
                    placeholder={t('notes.bodyPlaceholder')}
                    aria-label={t('notes.bodyPlaceholder')}
                    spellCheck={false}
                    className="relative block h-full w-full resize-none bg-transparent p-5 text-[14px] leading-7 break-words outline-none placeholder:text-muted/50 md:p-6"
                  />
                </div>
              </div>
            </>
          ) : (
            <Empty icon="notes" text={t('notes.empty')} />
          )}
        </div>
      </div>
      )}
    </div>
  );
}
