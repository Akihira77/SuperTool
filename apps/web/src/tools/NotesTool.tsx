import { useCallback, useEffect, useRef, useState } from 'react';
import { Empty, Icon, PageHeader, Spinner, cn } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useConfirm } from '../components/confirm';
import { useToast } from '../components/toast';
import { useSidebar } from '../lib/useSidebar';

type NoteMeta = { id: string; title: string; createdAt: number; updatedAt: number };
type Note = NoteMeta & { body: string };
type SearchScope = 'all' | 'title' | 'body';

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
  const [loading, setLoading] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  const searchStarted = useRef(false);

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
            <select value={scope} onChange={(e) => setScope(e.target.value as SearchScope)} aria-label={t('notes.searchScope')} className="input py-1 text-[11.5px]">
              <option value="all">{t('notes.searchAll')}</option>
              <option value="title">{t('notes.searchTitle')}</option>
              <option value="body">{t('notes.searchBody')}</option>
            </select>
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
                  <div className="text-[11px] text-muted">{timeAgo(note.updatedAt)}</div>
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
                <span className="text-[11px] text-muted">{active.body.length} {t('notes.characters')}</span>
                <button type="button" className="btn btn-danger" data-action="notes:delete" onClick={() => remove(active.id)} title={t("common.delete")}>
                  <Icon name="trash" />
                </button>
              </div>
              <textarea
                value={active.body}
                onChange={(e) => patch({ body: e.target.value })}
                placeholder={t('notes.bodyPlaceholder')}
                spellCheck={false}
                className="min-h-0 flex-1 resize-none bg-transparent p-5 text-[14px] leading-7 outline-none placeholder:text-muted/50 md:p-6"
              />
            </>
          ) : (
            <Empty icon="notes" text={t('notes.empty')} />
          )}
        </div>
      </div>
    </div>
  );
}
