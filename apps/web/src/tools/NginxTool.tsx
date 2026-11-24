import { useEffect, useRef, useState } from 'react';
import { CodeEditor } from '../components/CodeEditor';
import { Button, Empty, Icon, IconButton, Input, PageHeader, Panel, Skeleton, Spinner, cn } from '../components/ui';
import { useMenu } from '../lib/useMenu';
import { api, ApiError, qs } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useConfirm } from '../components/confirm';
import { useToast } from '../components/toast';
import { bytes, timeAgo } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import { useSidebar } from '../lib/useSidebar';

type ConfFile = { name: string; path: string; size: number; mtime: number; hasBackup: boolean };
type Menu = { x: number; y: number; text: string };
type Explain = { loading: boolean; text: string; error: string; model: string };

const WORD = /[A-Za-z0-9_\-./:$]/;

function pickText(source: string, start: number, end: number): string {
  const selected = source.slice(start, end).trim();
  if (selected) return selected;
  let from = start;
  let to = end;
  while (from > 0 && WORD.test(source[from - 1])) from -= 1;
  while (to < source.length && WORD.test(source[to])) to += 1;
  const word = source.slice(from, to).trim();
  if (word) return word;
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = source.indexOf('\n', end);
  return source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd).trim();
}

/** Ambil sekitar 15 baris sebelum/sesudah potongan, supaya LLM paham konteks blok. */
function contextAround(full: string, picked: string): string {
  const at = full.indexOf(picked);
  if (at < 0) return '';
  const lines = full.split('\n');
  const startLine = full.slice(0, at).split('\n').length - 1;
  const span = picked.split('\n').length;
  const from = Math.max(0, startLine - 15);
  const to = Math.min(lines.length, startLine + span + 15);
  return lines.slice(from, to).join('\n').slice(0, 12_000);
}

export default function NginxTool() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const toast = useToast();
  const [panelOpen, togglePanel] = useSidebar('nginx', true);
  const [dir, setDir] = useState('');
  const [files, setFiles] = useState<ConfFile[]>([]);
  const [activePath, setActivePath] = useState('');
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [explain, setExplain] = useState<Explain | null>(null);
  const [recents, setRecents] = useState<Array<{ path: string; openedAt: number }>>([]);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState(() => localStorage.getItem('st:llm:model') ?? '');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('st:llm:key') ?? '');
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLElement | null>(null);
  useMenu(Boolean(menu), (open) => { if (!open) setMenu(null); }, menuTriggerRef, menuRef);

  const loadModels = async (key = apiKey) => {
    try {
      const result = await api.get<{ models: string[] }>('/llm/models' + qs({ key }));
      setModels(result.models);
      setModel((current) => {
        if (current || !result.models.length) return current;
        localStorage.setItem('st:llm:model', result.models[0]);
        return result.models[0];
      });
    } catch {
      // daftar model opsional; input manual tetap bisa dipakai
    }
  };

  const dirty = activePath !== '' && text !== saved;
  const activeFile = files.find((file) => file.path === activePath);

  const loadRecents = async () => {
    try {
      const result = await api.get<{ paths: Array<{ path: string; openedAt: number }> }>('/recent?kind=nginx');
      setRecents(result.paths);
    } catch {
      // daftar terakhir dibuka bersifat opsional
    }
  };

  const loadList = async () => {
    try {
      const result = await api.get<{ dir: string; files: ConfFile[] }>('/nginx/files');
      setDir(result.dir);
      setFiles(result.files);
      if (!activePath && result.files.length) await open(result.files[0].path);
    } catch (err) {
      setNotice({ ok: false, message: err instanceof ApiError ? err.message : t('err.nginxFolder') });
    } finally {
      setLoading(false);
    }
  };

  const open = async (path: string) => {
    try {
      const file = await api.get<{ path: string; text: string }>('/nginx/file' + qs({ path }));
      setActivePath(path);
      setText(file.text);
      setSaved(file.text);
      setNotice(null);
      void loadRecents();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof ApiError ? err.message : t('err.openFile') });
    }
  };

  useEffect(() => {
    void loadList();
    void loadRecents();
    void loadModels(localStorage.getItem('st:llm:key') ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!activePath) return;
    setBusy(true);
    try {
      await api.put('/nginx/file', { path: activePath, content: text });
      setSaved(text);
      toast(t('nginx.saved'), 'ok');
      await loadList();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof ApiError ? err.message : t('err.save') });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ ok: boolean; output: string }>('/nginx/test');
      setNotice({ ok: result.ok, message: result.output });
    } catch (err) {
      setNotice({ ok: false, message: err instanceof ApiError ? err.message : 'nginx -t gagal' });
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const name = window.prompt('Nama file baru (mis. app.conf)');
    if (!name) return;
    try {
      const result = await api.post<{ path: string }>('/nginx/file', { name });
      await loadList();
      await open(result.path);
      toast(t('common.created') + ': ' + name, 'ok');
    } catch (err) {
      setNotice({ ok: false, message: err instanceof ApiError ? err.message : t('err.createFile') });
    }
  };

  const remove = async () => {
    if (!activePath) return;
    const ok = await confirm({ title: t('nginx.confirmDelete'), message: activePath, danger: true, confirmLabel: t('common.delete') });
    if (!ok) return;
    try {
      await api.del('/nginx/file' + qs({ path: activePath }));
      setActivePath('');
      setText('');
      setSaved('');
      await loadList();
      toast(t('common.deleted'), 'ok');
    } catch (err) {
      setNotice({ ok: false, message: err instanceof ApiError ? err.message : t('err.delete') });
    }
  };

  const revert = async () => {
    if (!activePath) return;
    const ok = await confirm({ title: t('nginx.confirmRestore'), danger: true, confirmLabel: t('common.confirm') });
    if (!ok) return;
    try {
      const result = await api.post<{ text: string }>('/nginx/revert', { path: activePath });
      setText(result.text);
      setSaved(result.text);
      await loadList();
      toast(t('common.saved'), 'ok');
    } catch (err) {
      setNotice({ ok: false, message: err instanceof ApiError ? err.message : t('err.restore') });
    }
  };

  const explainText = async (code: string) => {
    if (!code) return;
    if (!model) {
      setExplain({ loading: false, text: '', error: t('nginx.noModel'), model: '' });
      return;
    }
    setExplain({ loading: true, text: '', error: '', model });
    try {
      const result = await api.post<{ text: string; model: string }>('/llm/explain', {
        code,
        model,
        apiKey,
        path: activePath,
        context: contextAround(text, code),
      });
      setExplain({ loading: false, text: result.text, error: '', model: result.model });
    } catch (err) {
      setExplain({ loading: false, text: '', error: err instanceof ApiError ? err.message : 'LLM gagal dihubungi', model });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Nginx" subtitle={dir ? dir + ' · ' + files.length + ' file' : 'Konfigurasi nginx'} icon="nginx">
        <IconButton
          icon="panel"
          label={panelOpen ? 'Sembunyikan daftar' : 'Tampilkan daftar'}
          aria-pressed={panelOpen}
          onClick={togglePanel}
        />
        <Button icon="play" onClick={test} disabled={busy} title="nginx -t">
          Test
        </Button>
        <Button variant="primary" icon="save" data-action="nginx:save" onClick={save} disabled={!dirty} loading={busy} title="Ctrl+S">
          {t("common.save")}
        </Button>
      </PageHeader>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-panel/20 px-3 py-2">
        <Button size="sm" icon="plus" data-action="nginx:new" onClick={create}>
          {t('nginx.new')}
        </Button>
        <Button size="sm" icon="trash" onClick={remove} disabled={!activePath}>
          {t("common.delete")}
        </Button>
        <Button
          size="sm"
          icon="refresh"
          onClick={revert}
          disabled={!activeFile?.hasBackup}
          title={activeFile?.hasBackup ? 'Kembalikan isi cadangan .bak' : 'Belum ada cadangan'}
        >
          Kembalikan asli
        </Button>
        <Button size="sm" onClick={() => activePath && open(activePath)} disabled={!dirty}>
          {t('common.cancel')}
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              localStorage.setItem('st:llm:key', e.target.value);
            }}
            onBlur={() => void loadModels()}
            placeholder="API key (opsional)"
            className="w-36 py-1 text-[13px]"
            aria-label={t('a11y.llmApiKey')}
          />
          <Input
            list="st-llm-models"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              localStorage.setItem('st:llm:model', e.target.value);
            }}
            placeholder="model LLM"
            className="w-44 py-1 text-[13px]"
            aria-label={t('a11y.llmModel')}
          />
          <datalist id="st-llm-models">
            {models.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
          <span className="hidden text-[12px] text-muted md:inline">{t('nginx.hintExplain')}</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {panelOpen ? (
          <div className="flex w-64 shrink-0 flex-col border-r border-line bg-panel/25">
            {recents.length ? (
              <div className="mb-1 border-b border-line px-2 pt-2 pb-1">
                <div className="menu-label px-0 pb-1.5">{t('files.recent')}</div>
                {recents.slice(0, 5).map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => void open(item.path)}
                    title={item.path}
                    className="block min-h-8 w-full truncate rounded-control px-1.5 py-1 text-left text-[12.5px] text-muted transition-colors duration-[var(--duration-fast)] hover:bg-panel2 hover:text-ink focus-visible:bg-panel2 focus-visible:text-ink"
                  >
                    {item.path.split('/').pop()}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {loading ? (
                <div className="flex flex-col gap-1.5 p-1">
                  {Array.from({ length: 5 }, (_, index) => (
                    <Skeleton key={index} className="h-9 w-full" />
                  ))}
                </div>
              ) : files.length === 0 ? (
                <Empty icon="nginx" text={t('nginx.empty')} />
              ) : (
                files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => open(file.path)}
                    aria-current={activePath === file.path ? 'true' : undefined}
                    className={cn(
                      'mb-0.5 block w-full rounded-control px-2.5 py-2 text-left transition-colors duration-[var(--duration-fast)]',
                      activePath === file.path
                        ? 'bg-accent/12 ring-1 ring-inset ring-accent/25'
                        : 'hover:bg-panel2 focus-visible:bg-panel2',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={cn('truncate text-[13.5px] font-medium', activePath === file.path ? 'text-ink' : 'text-ink/90')}>
                        {file.name}
                      </span>
                      {file.hasBackup ? <span className="chip px-1.5 py-0.5">bak</span> : null}
                    </div>
                    <div className="text-[12px] text-muted">
                      {bytes(file.size)} · {timeAgo(file.mtime)}
                    </div>
                  </button>
                ))
              )}
            </div>
            {notice ? (
              <Panel
                className={cn(
                  'mono max-h-40 shrink-0 overflow-auto rounded-none border-x-0 border-b-0 border-t p-2 text-[12px] whitespace-pre-wrap',
                  notice.ok ? 'border-ok/30 text-ok' : 'border-bad/30 text-bad',
                )}
              >
                {notice.message}
              </Panel>
            ) : null}
          </div>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3 md:p-4">
          {activePath ? (
            <CodeEditor
              value={text}
              onChange={setText}
              onSave={save}
              wrap
              onContextMenu={(event) => {
                event.preventDefault();
                const area = event.currentTarget;
                const picked = pickText(text, area.selectionStart, area.selectionEnd);
                if (!picked) return;
                setMenu({
                  x: Math.min(event.clientX, window.innerWidth - 240),
                  y: Math.min(event.clientY, window.innerHeight - 140),
                  text: picked,
                });
              }}
            />
          ) : (
            <Empty icon="nginx" text={t('nginx.pickFile')} />
          )}
        </div>

        {explain ? (
          <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-panel/40 xl:w-96">
            <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel/30 px-3 py-2 text-[12px] text-muted">
              <Icon name="eye" size={13} />
              <span className="min-w-0 flex-1 truncate">{t('nginx.explainTitle')}{explain.model ? ' · ' + explain.model : ''}</span>
              <IconButton icon="x" label={t('common.close')} onClick={() => setExplain(null)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {explain.loading ? (
                <div className="flex items-center gap-2 p-2 text-sm text-muted">
                  <Spinner /> {t('nginx.explainLoading')}
                </div>
              ) : explain.error ? (
                <p className="p-2 text-sm text-bad">{explain.error}</p>
              ) : (
                <div className="md text-[14px]" dangerouslySetInnerHTML={{ __html: renderMarkdown(explain.text, { done: t('markdown.taskDone'), open: t('markdown.taskOpen'), code: t('markdown.codeBlock') }, { headingOffset: 1 }) }} />
              )}
            </div>
          </aside>
        ) : null}
      </div>

      {menu ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('a11y.textActions')}
          style={{ top: menu.y, left: menu.x }}
          className="popover fixed z-50 w-56"
        >
          <div className="mono mb-1 max-h-16 overflow-hidden rounded-control border-b border-line-soft px-1.5 pb-1.5 text-[12px] text-muted">
            {menu.text.slice(0, 120)}
          </div>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setMenu(null);
              void explainText(menu.text);
            }}
          >
            <Icon name="eye" size={14} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">Jelaskan ke LLM</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              void navigator.clipboard.writeText(menu.text);
              setMenu(null);
            }}
          >
            <Icon name="copy" size={14} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">Salin teks</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
