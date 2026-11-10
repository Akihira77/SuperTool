import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon, Spinner } from './ui';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useToast } from './toast';
import { useConfirm } from './confirm';
import { activateWorkspace, activeWorkspaceId, type Workspace } from '../lib/workspace';

type Draft = {
  id?: string;
  name: string;
  root: string;
  gitRepo: string;
  favoriteUrls: string;
  services: string;
  tools: string;
  shortcuts: string;
};

const EMPTY: Draft = { name: '', root: '', gitRepo: '', favoriteUrls: '', services: '', tools: '', shortcuts: '' };

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function draftOf(workspace: Workspace): Draft {
  const config = workspace.config ?? {};
  return {
    id: workspace.id,
    name: workspace.name,
    root: workspace.root,
    gitRepo: config.gitRepo ?? '',
    favoriteUrls: (config.favoriteUrls ?? []).join('\n'),
    services: (config.services ?? []).map((item) => item.name + ' | ' + item.url).join('\n'),
    tools: (config.tools ?? []).join(', '),
    shortcuts: (config.shortcuts ?? []).map((item) => item.label + ' | ' + item.path).join('\n'),
  };
}

function configOf(draft: Draft) {
  const services = lines(draft.services)
    .map((line) => {
      const at = line.indexOf('|');
      if (at < 0) return null;
      return { name: line.slice(0, at).trim(), url: line.slice(at + 1).trim() };
    })
    .filter((item): item is { name: string; url: string } => Boolean(item?.name && item?.url));
  const shortcuts = lines(draft.shortcuts)
    .map((line) => {
      const at = line.indexOf('|');
      if (at < 0) return null;
      return { label: line.slice(0, at).trim(), path: line.slice(at + 1).trim() };
    })
    .filter((item): item is { label: string; path: string } => Boolean(item?.label && item?.path));
  return {
    gitRepo: draft.gitRepo.trim() || undefined,
    favoriteUrls: lines(draft.favoriteUrls),
    services,
    tools: draft.tools.split(',').map((item) => item.trim()).filter(Boolean),
    shortcuts,
  };
}

export function WorkspacePanel() {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(activeWorkspaceId());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const fail = (err: unknown) => setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));

  const load = async () => {
    try {
      setItems(await api.get<Workspace[]>('/workspaces'));
      setError('');
    } catch (err) {
      fail(err);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    try {
      await api.post<Workspace>('/workspaces', {
        id: draft.id,
        name: draft.name,
        root: draft.root,
        config: configOf(draft),
      });
      setDraft(null);
      setError('');
      toast(t('settings.workspaceSaved'), 'ok');
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const activate = (workspace: Workspace) => {
    activateWorkspace(workspace);
    setActiveId(workspace.id);
    toast(t('settings.workspaceActivated'), 'ok');
  };

  const duplicate = async (workspace: Workspace) => {
    setBusy(true);
    try {
      await api.post('/workspaces/' + encodeURIComponent(workspace.id) + '/duplicate');
      toast(t('settings.workspaceDuplicated'), 'ok');
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (workspace: Workspace) => {
    const ok = await confirm({ title: t('settings.workspaceDelete'), message: workspace.name, danger: true, confirmLabel: t('settings.workspaceDelete') });
    if (!ok) return;
    setBusy(true);
    try {
      await api.del('/workspaces/' + encodeURIComponent(workspace.id));
      if (activeId === workspace.id) {
        localStorage.removeItem('st:workspace:active');
        localStorage.removeItem('st:workspace:root');
        setActiveId(null);
      }
      toast(t('settings.workspaceDeleted'), 'ok');
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const exportData = async () => {
    try {
      const data = await api.get<unknown>('/workspaces/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'workspaces.json';
      link.click();
      URL.revokeObjectURL(link.href);
      toast(t('settings.workspaceExported'), 'ok');
    } catch (err) {
      fail(err);
    }
  };

  const importFile = async (file: File) => {
    setBusy(true);
    try {
      const data = JSON.parse(await file.text()) as unknown;
      const result = await api.post<{ imported: number; skipped: number; errors: string[] }>('/workspaces/import', data);
      toast(t('settings.workspaceImported') + ' ' + result.imported + ' / ' + result.skipped, result.errors.length ? 'error' : 'ok');
      setError(result.errors.slice(0, 3).join('; '));
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-accent/15 text-accent"><Icon name="folder" size={14} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">{t('settings.workspace')}</div>
          <div className="text-[11.5px] text-muted">{t('settings.workspaceHint')}</div>
        </div>
        <button type="button" className="btn cursor-pointer" onClick={() => setDraft({ ...EMPTY })}>
          <Icon name="plus" size={13} /> {t('settings.workspaceNew')}
        </button>
        <button type="button" className="btn cursor-pointer" onClick={() => void exportData()} disabled={!items.length}>
          <Icon name="download" size={13} /> {t('settings.workspaceExport')}
        </button>
        <button type="button" className="btn cursor-pointer" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={13} /> {t('settings.workspaceImport')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const picked = event.target.files?.[0];
            if (picked) void importFile(picked);
            event.target.value = '';
          }}
        />
      </div>

      {items.length ? (
        <div className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line">
          {items.map((workspace) => (
            <div key={workspace.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[12.5px] font-medium">{workspace.name}</span>
                  {workspace.id === activeId ? <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">{t('settings.workspaceActive')}</span> : null}
                </div>
                <div className="truncate font-mono text-[10.5px] text-muted">{workspace.root}</div>
              </div>
              <button type="button" className="btn cursor-pointer px-2 py-1 text-[11px]" onClick={() => activate(workspace)}>
                {t('settings.workspaceActivate')}
              </button>
              <button type="button" className="btn btn-ghost cursor-pointer px-2 py-1 text-[11px]" onClick={() => setDraft(draftOf(workspace))}>
                {t('settings.workspaceEdit')}
              </button>
              <button type="button" className="btn btn-ghost cursor-pointer px-2 py-1 text-[11px]" onClick={() => void duplicate(workspace)} disabled={busy}>
                {t('settings.workspaceDuplicate')}
              </button>
              <button type="button" className="btn btn-ghost cursor-pointer px-2 py-1 text-[11px] text-bad" onClick={() => void remove(workspace)} disabled={busy}>
                {t('settings.workspaceDelete')}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11.5px] text-muted">{t('settings.workspaceEmpty')}</div>
      )}

      {draft ? (
        <form className="flex flex-col gap-2 rounded-lg border border-line bg-panel2/40 p-3" onSubmit={(event) => void save(event)}>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              {t('settings.workspaceName')}
              <input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required maxLength={80} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              {t('settings.workspaceRoot')}
              <input className="input font-mono" value={draft.root} onChange={(event) => setDraft({ ...draft, root: event.target.value })} required placeholder="/home/user/proyek" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              {t('settings.workspaceGit')}
              <input className="input font-mono" value={draft.gitRepo} onChange={(event) => setDraft({ ...draft, gitRepo: event.target.value })} placeholder={t('settings.workspaceOptional')} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              {t('settings.workspaceTools')}
              <input className="input" value={draft.tools} onChange={(event) => setDraft({ ...draft, tools: event.target.value })} placeholder="files, git, http" />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              {t('settings.workspaceUrls')}
              <textarea className="input min-h-16 font-mono" value={draft.favoriteUrls} onChange={(event) => setDraft({ ...draft, favoriteUrls: event.target.value })} placeholder={t('settings.workspaceOnePerLine')} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              {t('settings.workspaceServices')}
              <textarea className="input min-h-16 font-mono" value={draft.services} onChange={(event) => setDraft({ ...draft, services: event.target.value })} placeholder={t('settings.workspaceServiceFormat')} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              {t('settings.workspaceShortcuts')}
              <textarea className="input min-h-16 font-mono" value={draft.shortcuts} onChange={(event) => setDraft({ ...draft, shortcuts: event.target.value })} placeholder={t('settings.workspaceShortcutFormat')} />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" className="btn btn-primary cursor-pointer" disabled={busy}>
              {busy ? <Spinner /> : <Icon name="check" size={13} />} {t('settings.workspaceSave')}
            </button>
            <button type="button" className="btn cursor-pointer" onClick={() => setDraft(null)} disabled={busy}>
              {t('settings.workspaceCancel')}
            </button>
          </div>
        </form>
      ) : null}

      {error ? <div className="text-[11.5px] text-bad">{error}</div> : null}
    </div>
  );
}
