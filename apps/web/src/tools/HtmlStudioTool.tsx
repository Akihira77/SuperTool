import { useEffect, useRef, useState } from 'react';
import { CodeEditor } from '../components/CodeEditor';
import { Badge, Button, Empty, Icon, IconButton, PageHeader, SegmentedControl, Select, Tabs, cn } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useConfirm } from '../components/confirm';
import { useToast } from '../components/toast';
import { useI18n } from '../lib/i18n';
import { usePaletteIntent } from '../lib/palette';
import { formatDocument, loadFormatPreferences, saveFormatPreferences, type FormatPreferences } from '../lib/editorFormat';
import {
  PREVIEW_PRESETS,
  START_CSS,
  START_HTML,
  START_JS,
  composeDocument,
  createBaseline,
  dirtyState,
  parseImportPayload,
  type PreviewPreset,
  type StudioBaseline,
} from '../lib/htmlStudio';

type EditorTab = 'html' | 'css' | 'js';
type View = 'split' | 'edit' | 'preview';

const TABS: Array<{ id: EditorTab; key: 'htmlStudio.tabHtml' | 'htmlStudio.tabCss' | 'htmlStudio.tabJs' }> = [
  { id: 'html', key: 'htmlStudio.tabHtml' },
  { id: 'css', key: 'htmlStudio.tabCss' },
  { id: 'js', key: 'htmlStudio.tabJs' },
];

export default function HtmlStudioTool() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const toast = useToast();

  const [html, setHtml] = useState(START_HTML);
  const [css, setCss] = useState(START_CSS);
  const [js, setJs] = useState(START_JS);
  const [tab, setTab] = useState<EditorTab>('html');
  const [view, setView] = useState<View>(() =>
    window.matchMedia('(max-width: 1023px)').matches ? 'edit' : 'split',
  );
  const [preset, setPreset] = useState<PreviewPreset>('desktop');
  const [previewDoc, setPreviewDoc] = useState(() => composeDocument(START_HTML, START_CSS, START_JS));
  const [source, setSource] = useState<{ path: string; name: string } | null>(null);
  const [baseline, setBaseline] = useState<StudioBaseline>(() => createBaseline());
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [formatting, setFormatting] = useState(false);
  const [prefs, setPrefs] = useState<FormatPreferences>(() => loadFormatPreferences());
  const [prefsOpen, setPrefsOpen] = useState(false);
  const prefsRef = useRef<HTMLDivElement>(null);
  const prefsButtonRef = useRef<HTMLButtonElement>(null);
  // Nilai editor terbaru untuk mendeteksi edit saat formatting berjalan.
  const contentRef = useRef({ html, css, js });
  contentRef.current = { html, css, js };

  // Layar sempit tidak cukup untuk dua panel; mulai dari editor.
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)');
    const onChange = () => {
      if (query.matches) setView((current) => (current === 'split' ? 'edit' : current));
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Popover preferensi format: tutup saat Escape atau klik di luar.
  useEffect(() => {
    if (!prefsOpen) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (prefsRef.current?.contains(target) || prefsButtonRef.current?.contains(target)) return;
      // Listbox Select dirender di portal body; jangan tutup panel saat memilih.
      if (target?.closest?.('[role="listbox"]')) return;
      setPrefsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setPrefsOpen(false);
      prefsButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [prefsOpen]);

  // Debounce supaya ketikan tidak menyusun ulang iframe setiap karakter.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        setPreviewDoc(composeDocument(html, css, js));
        setError((current) => (current === t('htmlStudio.composeError') ? '' : current));
      } catch {
        setError(t('htmlStudio.composeError'));
      }
    }, 250);
    return () => clearTimeout(id);
  }, [html, css, js, t]);

  const dirty = dirtyState({ html, css, js }, baseline);
  // Berkas sumber hanya menampung tab HTML; CSS/JS tetap pekerjaan workspace.
  const onlyWorkspaceDirty = dirty.workspaceDirty && !dirty.sourceDirty;
  const empty = !html.trim() && !css.trim() && !js.trim();

  useEffect(() => {
    if (!dirty.workspaceDirty) return;
    const onUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty.workspaceDirty]);

  const exportDoc = () => {
    try {
      const blob = new Blob([composeDocument(html, css, js)], { type: 'text/html' });
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(blob);
      anchor.download = source?.name ?? 'index.html';
      anchor.click();
      URL.revokeObjectURL(anchor.href);
    } catch {
      setError(t('htmlStudio.composeError'));
    }
  };

  const save = async () => {
    if (!source || !dirty.sourceDirty || truncated || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.put('/fs/write', { path: source.path, content: html });
      setBaseline((current) => ({ ...current, html }));
      toast(t('common.saved'), 'ok');
    } catch (err) {
      // Konten editor tidak disentuh saat gagal, jadi pengguna bisa mencoba lagi.
      setError(err instanceof ApiError ? err.message : t('htmlStudio.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  // Workflow Files → HTML Studio: path + isi dari File Explorer.
  usePaletteIntent('html-studio', (action, payload) => {
    if (action !== 'open') return;
    void (async () => {
      const imported = parseImportPayload(payload);
      if (!imported) {
        setError(t('htmlStudio.importInvalid'));
        return;
      }
      if (dirty.workspaceDirty) {
        const ok = await confirm({
          title: t('htmlStudio.discardTitle'),
          message: t('htmlStudio.discardMessage') + ' ' + (source?.path ?? imported.path),
          danger: true,
        });
        if (!ok) return;
      }
      setHtml(imported.content);
      setCss('');
      setJs('');
      setTab('html');
      setView((current) => (current === 'preview' ? 'edit' : current));
      setSource({ path: imported.path, name: imported.name });
      setBaseline(createBaseline(imported.content, '', ''));
      setTruncated(imported.truncated);
      setError('');
    })();
  });

  const updatePrefs = (next: FormatPreferences) => {
    setPrefs(next);
    saveFormatPreferences(next);
  };

  // Format hanya tab aktif. Konten yang berubah saat menunggu tidak ditimpa.
  const formatActive = async () => {
    if (formatting) return;
    const language = tab;
    const before = contentRef.current[language];
    setFormatting(true);
    setError('');
    try {
      const next = await formatDocument(before, language, prefs);
      if (contentRef.current[language] !== before || next === before) return;
      if (language === 'html') setHtml(next);
      else if (language === 'css') setCss(next);
      else setJs(next);
    } catch (err) {
      const detail = err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : '';
      setError(t('htmlStudio.formatFailed') + (detail ? ': ' + detail : ''));
    } finally {
      setFormatting(false);
    }
  };

  const handleSaveShortcut = () => {
    if (source) {
      void save();
      return;
    }
    toast(t('htmlStudio.scratchSaveHint'));
  };

  const reset = async () => {
    const worked = source !== null || dirty.workspaceDirty;
    if (worked) {
      const ok = await confirm({
        title: t('htmlStudio.resetTitle'),
        message: t('htmlStudio.resetMessage'),
        confirmLabel: t('htmlStudio.reset'),
        danger: true,
      });
      if (!ok) return;
    }
    setHtml(START_HTML);
    setCss(START_CSS);
    setJs(START_JS);
    setSource(null);
    setBaseline(createBaseline());
    setTruncated(false);
    setError('');
  };

  const activeValue = tab === 'html' ? html : tab === 'css' ? css : js;
  const setActiveValue = tab === 'html' ? setHtml : tab === 'css' ? setCss : setJs;
  const editorLabel =
    tab === 'html' ? t('htmlStudio.htmlEditor') : tab === 'css' ? t('htmlStudio.cssEditor') : t('htmlStudio.jsEditor');
  const size = PREVIEW_PRESETS[preset];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="HTML Studio"
        subtitle={source ? source.path : t('htmlStudio.subtitle')}
        icon="html"
      >
        {source ? (
          <Badge tone={dirty.workspaceDirty ? 'warn' : 'ok'}>
            {dirty.sourceDirty
              ? t('htmlStudio.unsaved')
              : onlyWorkspaceDirty
                ? t('htmlStudio.workspaceUnsaved')
                : t('htmlStudio.saved')}
          </Badge>
        ) : null}
        <SegmentedControl
          items={[
            { id: 'edit', label: t('htmlStudio.modeEdit') },
            { id: 'split', label: t('htmlStudio.modeSplit') },
            { id: 'preview', label: t('htmlStudio.modePreview') },
          ]}
          value={view}
          onChange={setView}
          label={t('a11y.viewMode')}
        />
        <Button size="sm" icon="format" loading={formatting} disabled={formatting} onClick={() => void formatActive()}>
          {t('htmlStudio.format')}
        </Button>
        <div className="relative">
          <IconButton
            ref={prefsButtonRef}
            icon="settings"
            label={t('htmlStudio.formatPrefs')}
            aria-haspopup="dialog"
            aria-expanded={prefsOpen}
            aria-controls="html-studio-format-prefs"
            onClick={() => setPrefsOpen((open) => !open)}
          />
          {prefsOpen ? (
            <div
              ref={prefsRef}
              id="html-studio-format-prefs"
              role="dialog"
              aria-label={t('htmlStudio.formatPrefs')}
              className="popover absolute top-full right-0 z-[60] mt-1 flex w-64 max-w-[calc(100vw-1.5rem)] flex-col gap-2 p-3 shadow-elev-3"
            >
              <label className="flex items-center justify-between gap-2 text-[12.5px] text-muted">
                {t('htmlStudio.prefsIndent')}
                <Select
                  size="sm"
                  className="w-28"
                  label={t('htmlStudio.prefsIndent')}
                  value={String(prefs.tabWidth)}
                  onChange={(next) => updatePrefs({ ...prefs, tabWidth: Number(next) as 2 | 4 })}
                  options={[
                    { value: '2', label: t('htmlStudio.prefsIndent2') },
                    { value: '4', label: t('htmlStudio.prefsIndent4') },
                  ]}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-[12.5px] text-muted">
                {t('htmlStudio.prefsQuotes')}
                <Select
                  size="sm"
                  className="w-28"
                  label={t('htmlStudio.prefsQuotes')}
                  value={prefs.singleQuote ? 'single' : 'double'}
                  onChange={(next) => updatePrefs({ ...prefs, singleQuote: next === 'single' })}
                  options={[
                    { value: 'single', label: t('htmlStudio.prefsQuotesSingle') },
                    { value: 'double', label: t('htmlStudio.prefsQuotesDouble') },
                  ]}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-[12.5px] text-muted">
                {t('htmlStudio.prefsSemi')}
                <Select
                  size="sm"
                  className="w-28"
                  label={t('htmlStudio.prefsSemi')}
                  value={prefs.semi ? 'on' : 'off'}
                  onChange={(next) => updatePrefs({ ...prefs, semi: next === 'on' })}
                  options={[
                    { value: 'on', label: t('htmlStudio.prefsOn') },
                    { value: 'off', label: t('htmlStudio.prefsOff') },
                  ]}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-[12.5px] text-muted">
                {t('htmlStudio.prefsTrailing')}
                <Select
                  size="sm"
                  className="w-28"
                  label={t('htmlStudio.prefsTrailing')}
                  value={prefs.trailingComma}
                  onChange={(next) => updatePrefs({ ...prefs, trailingComma: next })}
                  options={[
                    { value: 'none', label: t('htmlStudio.prefsTrailingNone') },
                    { value: 'es5', label: t('htmlStudio.prefsTrailingEs5') },
                    { value: 'all', label: t('htmlStudio.prefsTrailingAll') },
                  ]}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-[12.5px] text-muted">
                {t('htmlStudio.prefsBracket')}
                <Select
                  size="sm"
                  className="w-28"
                  label={t('htmlStudio.prefsBracket')}
                  value={prefs.bracketSpacing ? 'on' : 'off'}
                  onChange={(next) => updatePrefs({ ...prefs, bracketSpacing: next === 'on' })}
                  options={[
                    { value: 'on', label: t('htmlStudio.prefsOn') },
                    { value: 'off', label: t('htmlStudio.prefsOff') },
                  ]}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-[12.5px] text-muted">
                {t('htmlStudio.prefsPrintWidth')}
                <Select
                  size="sm"
                  className="w-28"
                  label={t('htmlStudio.prefsPrintWidth')}
                  value={String(prefs.printWidth)}
                  onChange={(next) => updatePrefs({ ...prefs, printWidth: Number(next) as 80 | 100 | 120 })}
                  options={[
                    { value: '80', label: '80' },
                    { value: '100', label: '100' },
                    { value: '120', label: '120' },
                  ]}
                />
              </label>
              <p className="text-[11.5px] leading-relaxed text-muted/80">{t('htmlStudio.prefsNote')}</p>
            </div>
          ) : null}
        </div>
        {source ? (
          <Button
            size="sm"
            icon="save"
            variant="primary"
            data-action="html-studio:save"
            loading={busy}
            disabled={!dirty.sourceDirty || truncated}
            title={
              truncated
                ? t('htmlStudio.truncated')
                : !dirty.sourceDirty && dirty.workspaceDirty
                  ? t('htmlStudio.separateTabs')
                  : undefined
            }
            onClick={() => void save()}
          >
            {t('common.save')}
          </Button>
        ) : null}
        <Button size="sm" icon="download" data-action="html-studio:export" onClick={exportDoc}>
          {t('htmlStudio.export')}
        </Button>
        <Button size="sm" icon="refresh" onClick={() => void reset()}>
          {t('htmlStudio.reset')}
        </Button>
      </PageHeader>

      {error ? (
        <div role="alert" className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-[12.5px] text-bad">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button type="button" onClick={() => setError('')} className="shrink-0 rounded p-0.5 hover:bg-bad/20" aria-label={t('common.close')}>
            <Icon name="x" size={13} />
          </button>
        </div>
      ) : null}

      {truncated ? (
        <div role="status" className="mx-3 mt-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
          {t('htmlStudio.truncated')}
        </div>
      ) : null}

      <div className={cn('flex min-h-0 flex-1 flex-col lg:flex-row', view === 'split' && 'divide-y divide-line lg:divide-x lg:divide-y-0')}>
        {view !== 'preview' ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Tabs
                items={TABS.map((item) => ({
                  id: item.id,
                  label: t(item.key),
                  icon: item.id === 'html' ? 'html' : undefined,
                  panelId: 'html-studio-panel-' + item.id,
                }))}
                value={tab}
                onChange={setTab}
                label={t('htmlStudio.tabsLabel')}
              />
              <span className="mono ml-auto min-w-0 max-w-full truncate text-[11.5px] text-muted">
                {source ? source.name : t('htmlStudio.scratch')}
              </span>
            </div>
            {source && (css.trim() || js.trim()) ? (
              <p className="mb-2 text-[11.5px] leading-relaxed text-muted">{t('htmlStudio.separateTabs')}</p>
            ) : null}
            <div
              id={'html-studio-panel-' + tab}
              role="tabpanel"
              aria-label={editorLabel}
              className="flex min-h-0 flex-1 flex-col"
            >
              <CodeEditor
                value={activeValue}
                onChange={setActiveValue}
                language={tab}
                dataAction="html-studio:editor"
                placeholder={editorLabel}
                wrap
                onSave={handleSaveShortcut}
              />
            </div>
          </div>
        ) : null}

        {view !== 'edit' ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
              <SegmentedControl
                items={[
                  { id: 'desktop', label: t('htmlStudio.presetDesktop') },
                  { id: 'tablet', label: t('htmlStudio.presetTablet') },
                  { id: 'mobile', label: t('htmlStudio.presetMobile') },
                ]}
                value={preset}
                onChange={setPreset}
                label={t('htmlStudio.presetLabel')}
              />
              <span className="mono text-[11.5px] text-muted tabular-nums">
                {size.width}×{size.height}
              </span>
            </div>
            <p className="mx-3 mb-2 flex shrink-0 items-start gap-1.5 rounded-lg border border-line bg-panel2/40 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-muted">
              <Icon name="lock" size={13} className="mt-0.5 shrink-0 text-accent" />
              <span className="min-w-0">{t('htmlStudio.previewNotice')}</span>
            </p>
            {empty ? (
              <Empty text={t('htmlStudio.empty')} icon="html" />
            ) : (
              <div
                tabIndex={0}
                role="region"
                aria-label={t('htmlStudio.previewTitle')}
                className="min-h-0 flex-1 overflow-auto p-3"
              >
                <div className="mx-auto" style={{ width: size.width, maxWidth: '100%' }}>
                  <iframe
                    title={t('htmlStudio.previewTitle')}
                    data-preset={preset}
                    sandbox="allow-scripts"
                    referrerPolicy="no-referrer"
                    srcDoc={previewDoc}
                    className="block w-full rounded-lg border border-line bg-white shadow-elev-1"
                    style={{ height: size.height, maxHeight: '100%' }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
