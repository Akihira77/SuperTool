import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, Spinner, cn } from './ui';
import { useI18n } from '../lib/i18n';
import type { FilesSearchPayload } from '../lib/palette';

export type PaletteNode = {
  id: string;
  label: string;
  desc?: string;
  icon?: string;
  /** submenu statis atau dimuat saat dipilih */
  children?: PaletteNode[] | (() => Promise<PaletteNode[]>);
  /** buka form pencarian File Explorer */
  form?: 'files-search';
};

/**
 * Command palette dua tingkat: pilih menu → pilih aksi. Submenu bisa memuat
 * data (mis. daftar URL tersimpan) dan mengganti isi daftar di tempat.
 */
export default function CommandPalette({
  open,
  root,
  onClose,
  onRun,
}: {
  open: boolean;
  root: PaletteNode[];
  onClose: () => void;
  onRun: (path: PaletteNode[], node: PaletteNode, payload?: FilesSearchPayload) => void;
}) {
  const { t } = useI18n();
  const [stack, setStack] = useState<PaletteNode[]>([]);
  const [siblings, setSiblings] = useState<PaletteNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [form, setForm] = useState<FilesSearchPayload | null>(null);
  const [field, setField] = useState<'query' | 'include' | 'exclude'>('query');
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);

  const current = stack.length ? stack[stack.length - 1] : null;

  const items = (current ? siblings : root).filter((item) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return (item.label + ' ' + (item.desc ?? '') + ' ' + item.id).toLowerCase().includes(needle);
  });

  const close = useCallback(() => {
    setStack([]);
    setSiblings([]);
    setForm(null);
    setQuery('');
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    setStack([]);
    setSiblings([]);
    setForm(null);
    setQuery('');
    setActive(0);
    setField('query');
    const timer = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const enter = useCallback(
    async (node: PaletteNode) => {
      if (node.form === 'files-search') {
        setForm({ query: '', mode: 'name', include: '', exclude: '' });
        setQuery('');
        setTimeout(() => fieldRef.current?.focus(), 30);
        return;
      }
      if (node.children) {
        setLoading(true);
        const next = typeof node.children === 'function' ? await node.children() : node.children;
        setStack((prev) => [...prev, node]);
        setSiblings(next);
        setQuery('');
        setLoading(false);
        return;
      }
      onRun([...stack, node], node);
      close();
    },
    [close, onRun, stack],
  );

  const back = useCallback(() => {
    if (form) {
      setForm(null);
      return;
    }
    setStack((prev) => {
      const next = prev.slice(0, -1);
      const parent = next[next.length - 1];
      setSiblings(parent && typeof parent.children !== 'function' ? (parent.children ?? []) : []);
      return next;
    });
    setQuery('');
  }, [form]);

  const submitForm = useCallback(() => {
    if (!form) return;
    const filesNode: PaletteNode = { id: 'files:search', label: t('palette.searchFiles') };
    onRun([filesNode], { id: 'files:search-run', label: t('palette.searchFiles') }, { ...form });
    close();
  }, [close, form, onRun, t]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (stack.length || form) back();
        else close();
        return;
      }
      if (form) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((prev) => (items.length ? (prev + 1) % items.length : 0));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((prev) => (items.length ? (prev - 1 + items.length) % items.length : 0));
      } else if (event.key === 'Enter') {
        const target = items[active];
        if (target) {
          event.preventDefault();
          void enter(target);
        }
      } else if (event.key === 'Backspace' && !query && stack.length) {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, back, close, enter, form, items, open, query, stack.length]);

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [active, open, items]);

  if (!open) return null;

  const crumbs = stack.map((item) => item.label);

  const formFields: Array<{ key: 'query' | 'include' | 'exclude'; label: string; placeholder: string }> = [
    { key: 'query', label: t('palette.fieldQuery'), placeholder: t('palette.fieldQueryHint') },
    { key: 'include', label: t('palette.fieldInclude'), placeholder: 'src, apps/web' },
    { key: 'exclude', label: t('palette.fieldExclude'), placeholder: '*.log, node_modules/' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]" onMouseDown={close} role="presentation">
      <div
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          {form ? (
            <button type="button" className="cursor-pointer text-muted hover:text-ink" onClick={back} aria-label={t('palette.back')}>
              <Icon name="back" size={14} />
            </button>
          ) : (
            <Icon name="search" size={15} className="text-muted" />
          )}
          {form ? (
            <span className="text-[13px] text-ink">{t('palette.searchFiles')}</span>
          ) : (
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={crumbs.length ? t('palette.filterActions') : t('palette.placeholder')}
              className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-muted"
              autoComplete="off"
              spellCheck={false}
            />
          )}
          <kbd className="ml-auto rounded border border-line px-1 text-[10px] text-muted">esc</kbd>
        </div>

        {crumbs.length || form ? (
          <div className="flex items-center gap-1 border-b border-line/60 px-3 py-1 text-[10.5px] text-muted">
            <button type="button" className="cursor-pointer hover:text-ink" onClick={() => { setStack([]); setSiblings([]); setForm(null); }}>
              {t('palette.allMenus')}
            </button>
            {crumbs.map((crumb) => (
              <span key={crumb} className="flex items-center gap-1">
                <span>/</span>
                <span className="text-ink/80">{crumb}</span>
              </span>
            ))}
            {form ? (
              <span className="flex items-center gap-1">
                <span>/</span>
                <span className="text-ink/80">{t('palette.formTitle')}</span>
              </span>
            ) : null}
          </div>
        ) : null}

        {form ? (
          <div
            className="flex flex-col gap-2 p-3"
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || (event.target as HTMLElement).tagName === 'INPUT') return;
              event.preventDefault();
              submitForm();
            }}
          >
            <div className="flex items-center gap-1 rounded-lg border border-line p-0.5">
              {(['name', 'content'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setForm({ ...form, mode })}
                  className={cn('flex-1 cursor-pointer rounded-md px-2 py-1 text-[12px]', form.mode === mode ? 'bg-accent/15 text-accent' : 'text-muted hover:text-ink')}
                >
                  {mode === 'name' ? t('palette.modeName') : t('palette.modeContent')}
                </button>
              ))}
            </div>
            {formFields.map((item) => (
              <label key={item.key} className="flex flex-col gap-0.5">
                <span className="text-[10.5px] tracking-wide text-muted uppercase">{item.label}</span>
                <input
                  ref={item.key === field ? fieldRef : undefined}
                  value={form[item.key]}
                  onChange={(event) => setForm({ ...form, [item.key]: event.target.value })}
                  onFocus={() => setField(item.key)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    const order = ['query', 'include', 'exclude'] as const;
                    const next = order[order.indexOf(item.key) + 1];
                    if (!next) {
                      submitForm();
                      return;
                    }
                    setField(next);
                    requestAnimationFrame(() => fieldRef.current?.focus());
                  }}
                  placeholder={item.placeholder}
                  className="input py-1 text-[12.5px]"
                />
              </label>
            ))}
            <div className="flex items-center gap-2 pt-0.5">
              <span className="text-[10.5px] text-muted">{t('palette.formHint')}</span>
              <button type="button" className="btn btn-primary ml-auto cursor-pointer" onClick={submitForm}>
                <Icon name="search" size={13} /> {t('palette.runSearch')}
              </button>
            </div>
          </div>
        ) : (
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-muted">
                <Spinner /> {t('palette.loading')}
              </div>
            ) : (
              items.slice(0, 30).map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  data-active={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => void enter(item)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
                    index === active ? 'bg-accent/15 text-ink' : 'text-muted hover:bg-panel2',
                  )}
                >
                  <Icon name={item.icon ?? 'search'} size={14} className={index === active ? 'text-accent' : 'text-muted'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px]">{item.label}</span>
                    {item.desc ? <span className="block truncate text-[10.5px] text-muted">{item.desc}</span> : null}
                  </span>
                  {item.children || item.form ? <Icon name="chevronRight" size={12} className="text-muted/70" /> : null}
                </button>
              ))
            )}
            {!loading && !items.length ? (
              <div className="px-2 py-6 text-center text-[12px] text-muted">{t('palette.empty')} “{query}”.</div>
            ) : null}
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-[10.5px] text-muted">
          <span>↑↓ {t('palette.hintMove')}</span>
          <span>↵ {t('palette.hintOpen')}</span>
          <span>esc {crumbs.length ? t('palette.hintBack') : t('palette.hintClose')}</span>
          <span className="ml-auto">Ctrl/Cmd + K</span>
        </div>
      </div>
    </div>
  );
}
