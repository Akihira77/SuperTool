import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, PageHeader, Spinner, cn } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useSidebar } from '../lib/useSidebar';

type NoteMeta = { id: string; title: string; createdAt: number; updatedAt: number };
type Note = NoteMeta & { body: string };

type Status = 'idle' | 'saving' | 'saved' | 'error';

export default function NotesTool() {
  const [panelOpen, togglePanel] = useSidebar('notes', true);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [active, setActive] = useState<Note | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const timer = useRef<number | undefined>(undefined);

  const open = useCallback(async (id: string) => {
    const note = await api.get<Note>('/notes/' + id);
    setActive(note);
    setStatus('idle');
  }, []);

  const refresh = useCallback(async () => {
    const list = await api.get<NoteMeta[]>('/notes');
    setNotes(list);
    return list;
  }, []);

  useEffect(() => {
    refresh()
      .then((list) => (list.length ? open(list[0].id) : null))
      .catch(() => setStatus('error'))
      .finally(() => setLoading(false));
  }, [open, refresh]);

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
    const note = await api.post<Note>('/notes', { title: 'Catatan baru', body: '' });
    await refresh();
    setActive(note);
    setStatus('idle');
  };

  const remove = async (id: string) => {
    if (!window.confirm('Hapus catatan ini?')) return;
    await api.del('/notes/' + id);
    const list = await refresh();
    if (active?.id === id) {
      if (list.length) await open(list[0].id);
      else setActive(null);
    }
  };

  const filtered = query ? notes.filter((note) => note.title.toLowerCase().includes(query.toLowerCase())) : notes;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Catatan"
        subtitle={
          status === 'saving' ? 'Menyimpan...' : status === 'error' ? 'Gagal menyimpan' : status === 'saved' ? 'Tersimpan' : notes.length + ' catatan'
        }
      >
        <button type="button" className="btn" onClick={togglePanel} title={panelOpen ? 'Sembunyikan daftar' : 'Tampilkan daftar'}>
          <Icon name="panel" />
        </button>
        <button type="button" className="btn btn-primary" onClick={create}>
          <Icon name="plus" /> Baru
        </button>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        {panelOpen ? (
        <div className="flex w-64 shrink-0 flex-col border-r border-line">
          <div className="p-2">
            <div className="relative">
              <Icon name="search" className="absolute top-2.5 left-2.5 text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari catatan" className="input py-1.5 pl-8 text-[13px]" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {loading ? (
              <div className="flex justify-center p-6">
                <Spinner />
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted">Belum ada catatan</p>
            ) : (
              filtered.map((note) => (
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
              <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
                <input
                  value={active.title}
                  onChange={(e) => patch({ title: e.target.value })}
                  className="min-w-0 flex-1 border-0 bg-transparent px-1 text-[15px] font-semibold outline-none"
                  placeholder="Judul catatan"
                />
                <span className="text-[11px] text-muted">{active.body.length} karakter</span>
                <button type="button" className="btn btn-danger" onClick={() => remove(active.id)} title="Hapus">
                  <Icon name="trash" />
                </button>
              </div>
              <textarea
                value={active.body}
                onChange={(e) => patch({ body: e.target.value })}
                placeholder="Tulis apa saja di sini..."
                spellCheck={false}
                className="min-h-0 flex-1 resize-none bg-transparent p-4 text-[14px] leading-7 outline-none placeholder:text-muted/50"
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted">Pilih atau buat catatan baru</div>
          )}
        </div>
      </div>
    </div>
  );
}
