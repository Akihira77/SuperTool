import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, cn } from './ui';
import { useI18n } from '../lib/i18n';

export type CommandItem = {
  id: string;
  label: string;
  desc?: string;
  icon?: string;
  /** kelompok kecil di kanan (misal "menu", "aksi") */
  group?: string;
};

/**
 * Command palette minimal: Ctrl/Cmd+K, ketik untuk filter, Enter untuk jalan.
 * ponytail: tanpa cmdk — daftar item pendek, filter `includes` sudah cukup.
 */
export default function CommandPalette({
  open,
  items,
  onClose,
  onSelect,
}: {
  open: boolean;
  items: CommandItem[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items.slice(0, 12);
    return items
      .filter((item) => (item.label + ' ' + (item.desc ?? '') + ' ' + item.id).toLowerCase().includes(needle))
      .slice(0, 12);
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((prev) => (filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0));
      } else if (event.key === 'Enter') {
        const target = filtered[active];
        if (target) {
          event.preventDefault();
          onSelect(target.id);
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, filtered, onClose, onSelect, open]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <Icon name="search" size={15} className="text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('palette.placeholder')}
            className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-muted"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="rounded border border-line px-1 text-[10px] text-muted">esc</kbd>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {filtered.map((item, index) => (
            <button
              key={item.id}
              type="button"
              data-active={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                onSelect(item.id);
                onClose();
              }}
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
              {item.group ? <span className="text-[10px] tracking-wide text-muted/70 uppercase">{item.group}</span> : null}
            </button>
          ))}
          {!filtered.length ? (
            <div className="px-2 py-6 text-center text-[12px] text-muted">{t('palette.empty')} “{query}”.</div>
          ) : null}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-[10.5px] text-muted">
          <span>↑↓ pilih</span>
          <span>↵ buka</span>
          <span className="ml-auto">Ctrl/Cmd + K</span>
        </div>
      </div>
    </div>
  );
}
