import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusTrap } from '../lib/useFocusTrap';
import { fuzzyMatch, splitHighlight } from '../lib/fuzzy';
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
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [form, setForm] = useState<FilesSearchPayload | null>(null);
  const [field, setField] = useState<'query' | 'include' | 'exclude'>('query');
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, containerRef, inputRef);
  // Submenu async dimuat lebih awal supaya saat Enter ditekan daftarnya sudah siap.
  const prefetch = useRef<{ key: string; nodes: PaletteNode[] } | null>(null);
  const inflight = useRef<Promise<PaletteNode[]> | null>(null);

  const current = stack.length ? stack[stack.length - 1] : null;

  const entries = useMemo(() => {
    return (current ? siblings : root)
      .map((item) => {
        const match = fuzzyMatch(item.label + ' ' + (item.desc ?? '') + ' ' + item.id, query);
        return match ? { item, hits: match.hits, score: match.score } : null;
      })
      .filter((entry): entry is { item: PaletteNode; hits: number[]; score: number } => Boolean(entry))
      .sort((left, right) => (query.trim() ? right.score - left.score : 0));
  }, [current, query, root, siblings]);
  const items = entries.map((entry) => entry.item);

  const close = useCallback(() => {
    setStack([]);
    setSiblings([]);
    setForm(null);
    setQuery('');
    setError('');
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    setStack([]);
    setSiblings([]);
    setForm(null);
    setQuery('');
    setActive(0);
    setError('');
    prefetch.current = null;
    setField('query');
    const timer = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query, stack.length, open]);

  // Prefetch anak async (mis. daftar URL di URL Viewer) saat submenu tampil.
  useEffect(() => {
    if (!open || loading) return;
    const parent = current?.id ?? 'root';
    const pending = items.find((item) => typeof item.children === 'function');
    if (!pending || prefetch.current?.key === pending.id || inflight.current) return;
    const promise = (pending.children as () => Promise<PaletteNode[]>)();
    inflight.current = promise;
    void promise
      .then((nodes) => {
        prefetch.current = { key: pending.id, nodes };
      })
      .catch(() => undefined)
      .finally(() => {
        inflight.current = null;
      });
    void parent;
  }, [current, items, loading, open]);

  const enter = useCallback(
    async (node: PaletteNode) => {
      if (node.form === 'files-search') {
        setForm({ query: '', mode: 'name', include: '', exclude: '' });
        setQuery('');
        setTimeout(() => fieldRef.current?.focus(), 30);
        return;
      }
      if (node.children) {
        if (Array.isArray(node.children)) {
          setStack((prev) => [...prev, node]);
          setSiblings(node.children);
          setQuery('');
          return;
        }
        const cached = prefetch.current?.key === node.id ? prefetch.current.nodes : null;
        if (cached) {
          setStack((prev) => [...prev, node]);
          setSiblings(cached);
          setQuery('');
          return;
        }
        setLoading(true);
        setError('');
        try {
          const next = await node.children();
          setStack((prev) => [...prev, node]);
          setSiblings(next);
          setQuery('');
        } catch {
          setError(t('palette.loadError'));
        } finally {
          setLoading(false);
        }
        return;
      }
      onRun([...stack, node], node);
      close();
    },
    [close, onRun, stack, t],
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
        if (target && !loading) {
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
  }, [active, back, close, enter, form, items, loading, open, query, stack.length]);

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  const crumbs = stack.map((item) => item.label);

  const formFields: Array<{ key: 'query' | 'include' | 'exclude'; label: string; placeholder: string }> = [
    { key: 'query', label: t('palette.fieldQuery'), placeholder: t('palette.fieldQueryHint') },
    { key: 'include', label: t('palette.fieldInclude'), placeholder: 'src, apps/web' },
    { key: 'exclude', label: t('palette.fieldExclude'), placeholder: '*.log, node_modules/' },
  ];

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 p-2 pt-[6dvh] backdrop-blur-[2px] sm:p-4 sm:pt-[11vh]" onMouseDown={close} role="presentation">
      <div
        ref={containerRef}
        className="flex max-h-[min(78dvh,42rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-[0_30px_100px_-30px_rgb(0_0_0/0.9)] ring-1 ring-white/[0.03] sm:rounded-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
      >
        <div className="flex items-center gap-2.5 border-b border-line bg-panel/80 px-4 py-3">
          {form ? (
            <button type="button" className="cursor-pointer text-muted hover:text-ink" onClick={back} aria-label={t('palette.back')}>
              <Icon name="back" size={14} />
            </button>
          ) : (
            <Icon name="search" size={15} className="text-muted" />
          )}
          {form ? (
            <span className="text-[13.5px] text-ink">{t('palette.searchFiles')}</span>
          ) : (
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={crumbs.length ? t('palette.filterActions') : t('palette.placeholder')}
              className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-muted"
              autoComplete="off"
              spellCheck={false}
            />
          )}
          <kbd className="kbd ml-auto">esc</kbd>
        </div>

        {crumbs.length || form ? (
          <div className="flex items-center gap-1 border-b border-line/60 px-3 py-1 text-[12.5px] text-muted">
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
                  className={cn('flex-1 cursor-pointer rounded-md px-2 py-1 text-[13px]', form.mode === mode ? 'bg-accent/15 text-accent' : 'text-muted hover:text-ink')}
                >
                  {mode === 'name' ? t('palette.modeName') : t('palette.modeContent')}
                </button>
              ))}
            </div>
            {formFields.map((item) => (
              <label key={item.key} className="flex flex-col gap-0.5">
                <span className="text-[12.5px] tracking-wide text-muted uppercase">{item.label}</span>
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
                  className="input py-1 text-[13.5px]"
                />
              </label>
            ))}
            <div className="flex items-center gap-2 pt-0.5">
              <span className="text-[12.5px] text-muted">{t('palette.formHint')}</span>
              <button type="button" className="btn btn-primary ml-auto cursor-pointer" onClick={submitForm}>
                <Icon name="search" size={13} /> {t('palette.runSearch')}
              </button>
            </div>
          </div>
        ) : (
          <div ref={listRef} id="palette-results" role="listbox" aria-label={t('palette.results')} className="min-h-0 flex-1 overflow-y-auto p-2">
            {error ? (
              <div role="alert" className="m-1 rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-[12.5px] text-bad">
                {error}
              </div>
            ) : null}
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-muted">
                <Spinner /> {t('palette.loading')}
              </div>
            ) : (
              entries.slice(0, 30).map(({ item, hits }, index) => (
                <button
                  key={item.id}
                  id={'palette-item-' + index}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  data-active={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => void enter(item)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                    index === active ? 'bg-accent/15 text-ink' : 'text-muted hover:bg-panel2',
                  )}
                >
                  <Icon name={item.icon ?? 'search'} size={15} className={index === active ? 'text-accent' : 'text-muted'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">
                      {splitHighlight(item.label, hits.filter((hit) => hit < item.label.length)).map((part, partIndex) =>
                        part.hit ? (
                          <mark key={partIndex} className="rounded-sm bg-accent/25 px-0.5 text-ink">{part.text}</mark>
                        ) : (
                          <span key={partIndex}>{part.text}</span>
                        ),
                      )}
                    </span>
                    {item.desc ? <span className="block truncate text-[12.5px] text-muted">{item.desc}</span> : null}
                  </span>
                  {item.children || item.form ? <Icon name="chevronRight" size={13} className="text-muted/70" /> : null}
                </button>
              ))
            )}
            {!loading && !items.length && !error ? (
              <div className="px-2 py-8 text-center text-[13px] text-muted">{t('palette.empty')} “{query}”.</div>
            ) : null}
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-line bg-panel/50 px-4 py-2 text-[12.5px] text-muted">
          <span>↑↓ {t('palette.hintMove')}</span>
          <span>↵ {t('palette.hintOpen')}</span>
          <span>esc {crumbs.length ? t('palette.hintBack') : t('palette.hintClose')}</span>
          <span className="ml-auto">Ctrl/Cmd + K</span>
        </div>
      </div>
    </div>
  );
}