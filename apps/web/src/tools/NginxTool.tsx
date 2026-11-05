import { useEffect, useState } from 'react';
import { CodeEditor } from '../components/CodeEditor';
import { Icon, PageHeader, Spinner, cn } from '../components/ui';
import { api, ApiError, qs } from '../lib/api';
import { bytes, timeAgo } from '../lib/format';

type ConfFile = { name: string; path: string; size: number; mtime: number };

export default function NginxTool() {
  const [dir, setDir] = useState('');
  const [files, setFiles] = useState<ConfFile[]>([]);
  const [activePath, setActivePath] = useState('');
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const dirty = activePath !== '' && text !== saved;

  const loadList = async () => {
    try {
      const result = await api.get<{ dir: string; files: ConfFile[] }>('/nginx/files');
      setDir(result.dir);
      setFiles(result.files);
      if (!activePath && result.files.length) await open(result.files[0].path);
    } catch (err) {
      setNotice({ ok: false, message: err instanceof ApiError ? err.message : 'Gagal membaca folder nginx' });
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
    } catch (err) {
      setNotice({ ok: false, message: err instanceof ApiError ? err.message : 'Gagal membuka file' });
    }
  };

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!activePath) return;
    setBusy(true);
    try {
      await api.put('/nginx/file', { path: activePath, content: text });
      setSaved(text);
      setNotice({ ok: true, message: 'File tersimpan' });
    } catch (err) {
      setNotice({ ok: false, message: err instanceof ApiError ? err.message : 'Gagal menyimpan' });
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Nginx" subtitle={dir ? dir + ' · ' + files.length + ' file' : 'Konfigurasi nginx'}>
        <button type="button" className="btn" onClick={test} disabled={busy} title="nginx -t">
          <Icon name="play" /> Test konfig
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || busy} title="Ctrl+S">
          {busy ? <Spinner /> : <Icon name="save" />} Simpan
        </button>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-64 shrink-0 flex-col border-r border-line">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="flex justify-center p-6">
                <Spinner />
              </div>
            ) : files.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted">Tidak ada file .conf terbaca</p>
            ) : (
              files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => open(file.path)}
                  className={cn(
                    'mb-0.5 block w-full rounded-lg px-2.5 py-2 text-left transition-colors',
                    activePath === file.path ? 'bg-accent/12' : 'hover:bg-panel2',
                  )}
                >
                  <div className="truncate text-[12.5px] font-medium">{file.name}</div>
                  <div className="text-[11px] text-muted">
                    {bytes(file.size)} · {timeAgo(file.mtime)}
                  </div>
                </button>
              ))
            )}
          </div>
          {notice ? (
            <div
              className={cn(
                'mono max-h-40 shrink-0 overflow-auto border-t border-line p-2 text-[11px] whitespace-pre-wrap',
                notice.ok ? 'text-ok' : 'text-bad',
              )}
            >
              {notice.message}
            </div>
          ) : null}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3">
          {activePath ? (
            <CodeEditor value={text} onChange={setText} onSave={save} wrap />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted">Pilih file konfigurasi</div>
          )}
        </div>
      </div>
    </div>
  );
}
