import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Badge, Button, Icon, IconButton, Input } from './ui';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useToast } from './toast';
import { useConfirm } from './confirm';
import { useProject } from '../lib/project';
import { activateWorkspace, activeWorkspaceId, type Workspace } from '../lib/workspace';

type UrlRow = { key: string; value: string };
type ServiceRow = { key: string; name: string; url: string };
type ShortcutRow = { key: string; label: string; path: string };
type Draft = {
  id?: string;
  name: string;
  root: string;
  gitRepo: string;
  favoriteUrls: UrlRow[];
  services: ServiceRow[];
  tools: string[];
  shortcuts: ShortcutRow[];
};

let rowSeq = 0;
const rowKey = () => 'row-' + (++rowSeq);

const EMPTY: Draft = {
  name: '',
  root: '',
  gitRepo: '',
  favoriteUrls: [],
  services: [],
  tools: [],
  shortcuts: [],
};

function draftOf(workspace: Workspace): Draft {
  const config = workspace.config ?? {};
  return {
    id: workspace.id,
    name: workspace.name,
    root: workspace.root,
    gitRepo: config.gitRepo ?? '',
    favoriteUrls: (config.favoriteUrls ?? []).map((value) => ({ key: rowKey(), value })),
    services: (config.services ?? []).map((item) => ({ key: rowKey(), name: item.name, url: item.url })),
    tools: config.tools ?? [],
    shortcuts: (config.shortcuts ?? []).map((item) => ({ key: rowKey(), label: item.label, path: item.path })),
  };
}

type Config = {
  gitRepo?: string;
  favoriteUrls: string[];
  services: Array<{ name: string; url: string }>;
  tools: string[];
  shortcuts: Array<{ label: string; path: string }>;
};

function configOf(draft: Draft): Config {
  return {
    gitRepo: draft.gitRepo.trim() || undefined,
    favoriteUrls: draft.favoriteUrls.map((row) => row.value.trim()).filter(Boolean),
    services: draft.services
      .map((row) => ({ name: row.name.trim(), url: row.url.trim() }))
      .filter((row) => row.name && row.url),
    tools: draft.tools.map((tool) => tool.trim()).filter(Boolean),
    shortcuts: draft.shortcuts
      .map((row) => ({ label: row.label.trim(), path: row.path.trim() }))
      .filter((row) => row.label && row.path),
  };
}

function validate(draft: Draft, t: ReturnType<typeof useI18n>['t']): string {
  if (!draft.name.trim()) return t('settings.workspaceNameRequired');
  if (!draft.root.trim()) return t('settings.workspaceRootRequired');
  for (const row of draft.favoriteUrls) {
    const value = row.value.trim();
    if (value && !/^https?:\/\//i.test(value)) return t('settings.workspaceUrlInvalid');
  }
  for (const row of draft.services) {
    if (Boolean(row.name.trim()) !== Boolean(row.url.trim())) return t('settings.workspaceServiceInvalid');
    if (row.url.trim() && !/^https?:\/\//i.test(row.url.trim())) return t('settings.workspaceUrlInvalid');
  }
  for (const row of draft.shortcuts) {
    if (Boolean(row.label.trim()) !== Boolean(row.path.trim())) return t('settings.workspaceShortcutInvalid');
  }
  return '';
}

export function WorkspacePanel() {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { projectPath } = useProject();
  const [items, setItems] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(activeWorkspaceId());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toolDraft, setToolDraft] = useState('');
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
    const problem = validate(draft, t);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await api.post<Workspace>('/workspaces', {
        id: draft.id,
        name: draft.name.trim(),
        root: draft.root.trim(),
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
    const ok = await confirm({
      title: t('settings.workspaceDelete'),
      message: workspace.name + ' — ' + t('settings.workspaceDeleteBody'),
      danger: true,
      confirmLabel: t('settings.workspaceDelete'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.del('/workspaces/' + encodeURIComponent(workspace.id));
      if (activeId === workspace.id) {
        localStorage.removeItem('st:workspace:active');
        localStorage.removeItem('st:workspace:root');
        localStorage.removeItem('st:files:root');
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

  const addTool = () => {
    if (!draft) return;
    const value = toolDraft.trim();
    if (!value || draft.tools.includes(value)) return;
    setDraft({ ...draft, tools: [...draft.tools, value] });
    setToolDraft('');
  };

  return (
    <section className="card flex flex-col gap-3 p-4" aria-labelledby="workspace-panel-title">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-accent/15 text-accent"><Icon name="folder" size={15} /></span>
        <div className="min-w-0 flex-1">
          <h2 id="workspace-panel-title" className="text-[15px] font-semibold">{t('settings.workspace')}</h2>
          <p className="text-[12.5px] text-muted">{t('settings.workspaceHint')}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" icon="plus" onClick={() => { setDraft({ ...EMPTY }); setError(''); }} disabled={busy}>
            {t('settings.workspaceNew')}
          </Button>
          <Button size="sm" icon="download" onClick={() => void exportData()} disabled={!items.length || busy}>
            {t('settings.workspaceExport')}
          </Button>
          <Button size="sm" icon="upload" onClick={() => fileRef.current?.click()} disabled={busy}>
            {t('settings.workspaceImport')}
          </Button>
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
      </div>

      {items.length ? (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line">
          {items.map((workspace) => {
            const active = workspace.id === activeId;
            return (
              <li key={workspace.id} className={active ? 'flex flex-wrap items-center gap-2 border-l-2 border-l-accent bg-accent/5 px-3 py-2.5' : 'flex flex-wrap items-center gap-2 border-l-2 border-l-transparent px-3 py-2.5'}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium">{workspace.name}</span>
                    {active ? <Badge tone="accent">{t('settings.workspaceActive')}</Badge> : null}
                  </div>
                  <div className="truncate font-mono text-[12.5px] text-muted" title={workspace.root}>{workspace.root}</div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {!active ? (
                    <Button size="sm" onClick={() => activate(workspace)} disabled={busy}>
                      {t('settings.workspaceActivate')}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" icon="edit" onClick={() => { setDraft(draftOf(workspace)); setError(''); }}>
                    {t('settings.workspaceEdit')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void duplicate(workspace)} disabled={busy}>
                    {t('settings.workspaceDuplicate')}
                  </Button>
                  <IconButton
                    icon="trash"
                    tone="danger"
                    label={t('settings.workspaceDelete') + ': ' + workspace.name}
                    size="md"
                    onClick={() => void remove(workspace)}
                    disabled={busy}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-[12.5px] text-muted">{t('settings.workspaceEmpty')}</div>
      )}

      {draft ? (
        <form className="flex flex-col gap-4 rounded-lg border border-line bg-panel2/40 p-3 sm:p-4" onSubmit={(event) => void save(event)} aria-busy={busy}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-[12.5px] text-muted">
              {t('settings.workspaceName')}
              <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required maxLength={80} />
            </label>
            <label className="flex flex-col gap-1.5 text-[12.5px] text-muted">
              {t('settings.workspaceRoot')}
              <div className="flex gap-1.5">
                <Input className="font-mono" value={draft.root} onChange={(event) => setDraft({ ...draft, root: event.target.value })} required placeholder="/home/user/proyek" />
                {projectPath ? (
                  <Button
                    className="shrink-0"
                    icon="folder"
                    aria-label={t('settings.workspaceUseProject')}
                    onClick={() => setDraft({ ...draft, root: projectPath })}
                    title={t('settings.workspaceUseProject')}
                  >
                    <span className="hidden sm:inline">{t('settings.workspaceUseProject')}</span>
                  </Button>
                ) : null}
              </div>
            </label>
            <label className="flex flex-col gap-1.5 text-[12.5px] text-muted">
              {t('settings.workspaceGit')}
              <Input className="font-mono" value={draft.gitRepo} onChange={(event) => setDraft({ ...draft, gitRepo: event.target.value })} placeholder={t('settings.workspaceOptional')} />
            </label>
            <div className="flex flex-col gap-1.5 text-[12.5px] text-muted">
              <span>{t('settings.workspaceTools')}</span>
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-panel2/55 p-1.5">
                {draft.tools.map((tool) => (
                  <span key={tool} className="chip">
                    {tool}
                    <button type="button" className="ml-0.5 rounded p-0.5 text-muted hover:bg-bad/15 hover:text-bad" aria-label={t('settings.workspaceRemoveTool') + ': ' + tool} onClick={() => setDraft({ ...draft, tools: draft.tools.filter((item) => item !== tool) })}>
                      <Icon name="x" size={10} />
                    </button>
                  </span>
                ))}
                <input
                  value={toolDraft}
                  onChange={(event) => setToolDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ',') {
                      event.preventDefault();
                      addTool();
                    }
                  }}
                  onBlur={addTool}
                  placeholder={t('settings.workspaceToolsPlaceholder')}
                  aria-label={t('settings.workspaceTools')}
                  className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-[12.5px] text-ink outline-none placeholder:text-muted/60"
                />
              </div>
            </div>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 flex w-full items-center justify-between gap-2 text-[12.5px] font-medium text-ink">
              {t('settings.workspaceUrls')}
              <Button size="sm" icon="plus" onClick={() => setDraft({ ...draft, favoriteUrls: [...draft.favoriteUrls, { key: rowKey(), value: '' }] })}>
                {t('settings.workspaceAddUrl')}
              </Button>
            </legend>
            {draft.favoriteUrls.length ? draft.favoriteUrls.map((row, index) => (
              <div key={row.key} className="flex gap-1.5">
                <Input
                  className="font-mono"
                  type="url"
                  value={row.value}
                  placeholder="https://example.com"
                  aria-label={t('settings.workspaceUrls') + ' ' + (index + 1)}
                  onChange={(event) => setDraft({ ...draft, favoriteUrls: draft.favoriteUrls.map((item) => item.key === row.key ? { ...item, value: event.target.value } : item) })}
                />
                <IconButton
                  icon="trash"
                  label={t('settings.workspaceRemoveUrl')}
                  size="md"
                  onClick={() => setDraft({ ...draft, favoriteUrls: draft.favoriteUrls.filter((item) => item.key !== row.key) })}
                />
              </div>
            )) : <p className="hint">{t('settings.workspaceNoUrls')}</p>}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 flex w-full items-center justify-between gap-2 text-[12.5px] font-medium text-ink">
              {t('settings.workspaceServices')}
              <Button size="sm" icon="plus" onClick={() => setDraft({ ...draft, services: [...draft.services, { key: rowKey(), name: '', url: '' }] })}>
                {t('settings.workspaceAddService')}
              </Button>
            </legend>
            {draft.services.length ? draft.services.map((row, index) => (
              <div key={row.key} className="grid gap-1.5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
                <Input
                  value={row.name}
                  placeholder={t('settings.workspaceServiceName')}
                  aria-label={t('settings.workspaceServiceName') + ' ' + (index + 1)}
                  onChange={(event) => setDraft({ ...draft, services: draft.services.map((item) => item.key === row.key ? { ...item, name: event.target.value } : item) })}
                />
                <Input
                  className="font-mono"
                  type="url"
                  value={row.url}
                  placeholder="http://127.0.0.1:3001"
                  aria-label={t('settings.workspaceServiceUrl') + ' ' + (index + 1)}
                  onChange={(event) => setDraft({ ...draft, services: draft.services.map((item) => item.key === row.key ? { ...item, url: event.target.value } : item) })}
                />
                <IconButton
                  icon="trash"
                  label={t('settings.workspaceRemoveService')}
                  size="md"
                  onClick={() => setDraft({ ...draft, services: draft.services.filter((item) => item.key !== row.key) })}
                />
              </div>
            )) : <p className="hint">{t('settings.workspaceNoServices')}</p>}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 flex w-full items-center justify-between gap-2 text-[12.5px] font-medium text-ink">
              {t('settings.workspaceShortcuts')}
              <Button size="sm" icon="plus" onClick={() => setDraft({ ...draft, shortcuts: [...draft.shortcuts, { key: rowKey(), label: '', path: '' }] })}>
                {t('settings.workspaceAddShortcut')}
              </Button>
            </legend>
            {draft.shortcuts.length ? draft.shortcuts.map((row, index) => (
              <div key={row.key} className="grid gap-1.5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
                <Input
                  value={row.label}
                  placeholder={t('settings.workspaceShortcutLabel')}
                  aria-label={t('settings.workspaceShortcutLabel') + ' ' + (index + 1)}
                  onChange={(event) => setDraft({ ...draft, shortcuts: draft.shortcuts.map((item) => item.key === row.key ? { ...item, label: event.target.value } : item) })}
                />
                <Input
                  className="font-mono"
                  value={row.path}
                  placeholder="/path/atau/url"
                  aria-label={t('settings.workspaceShortcutPath') + ' ' + (index + 1)}
                  onChange={(event) => setDraft({ ...draft, shortcuts: draft.shortcuts.map((item) => item.key === row.key ? { ...item, path: event.target.value } : item) })}
                />
                <IconButton
                  icon="trash"
                  label={t('settings.workspaceRemoveShortcut')}
                  size="md"
                  onClick={() => setDraft({ ...draft, shortcuts: draft.shortcuts.filter((item) => item.key !== row.key) })}
                />
              </div>
            )) : <p className="hint">{t('settings.workspaceNoShortcuts')}</p>}
          </fieldset>

          {error ? <div role="alert" className="rounded-md border border-bad/30 bg-bad/10 px-2.5 py-2 text-[12.5px] text-bad">{error}</div> : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <Button type="submit" variant="primary" icon="check" loading={busy} disabled={busy}>
              {t('settings.workspaceSave')}
            </Button>
            <Button onClick={() => { setDraft(null); setError(''); }} disabled={busy}>
              {t('settings.workspaceCancel')}
            </Button>
            <span className="hint ml-auto hidden sm:inline">{t('settings.workspaceFormHint')}</span>
          </div>
        </form>
      ) : null}

      {error && !draft ? <div role="alert" className="text-[12.5px] text-bad">{error}</div> : null}
    </section>
  );
}
