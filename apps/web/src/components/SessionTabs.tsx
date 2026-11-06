import { useEffect, useRef, useState } from 'react';
import { Icon, cn } from './ui';
import { useI18n } from '../lib/i18n';
import type { ToolSession } from '../lib/sessions';

type SessionTool = { id: string; key: string; label: string; icon: string };

type Props = {
  tools: SessionTool[];
  sessions: ToolSession[];
  activeId: string | null;
  max: number;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onReorder: (fromId: string, toId: string) => void;
  onAdd: (toolId: string) => void;
};

/** Tab sesi tingkat aplikasi. Tool di dalam sesi tidak punya tab sendiri. */
export function SessionTabs({
  tools,
  sessions,
  activeId,
  max,
  onActivate,
  onClose,
  onRename,
  onReorder,
  onAdd,
}: Props) {
  const { t } = useI18n();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setAddOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAddOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [addOpen]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  const toolFor = (id: string) => tools.find((tool) => tool.id === id);
  const labelFor = (tool: SessionTool | undefined, fallback: string) =>
    tool ? t(tool.key as 'nav.markdown', tool.label) : fallback;

  const startRename = (session: ToolSession) => {
    setEditingId(session.id);
    setDraft(session.name);
  };

  const commitRename = (session: ToolSession) => {
    const name = draft.trim();
    if (name && name !== session.name) onRename(session.id, name);
    setEditingId(null);
  };

  const dropOn = (targetId: string) => {
    if (dragId && dragId !== targetId) onReorder(dragId, targetId);
    setDragId(null);
    setOverId(null);
  };

  return (
    <div
      ref={rootRef}
      className="flex shrink-0 items-center gap-1 border-b border-line bg-panel/35 px-2 py-1.5 md:px-3"
    >
      <div
        role="tablist"
        aria-label={t('session.listLabel')}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5"
      >
        {sessions.map((session) => {
          const tool = toolFor(session.tool);
          const active = session.id === activeId;
          const editing = session.id === editingId;
          return (
            <div
              key={session.id}
              ref={active ? activeRef : undefined}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              draggable={!editing}
              title={t('session.renameHint')}
              onClick={() => onActivate(session.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onActivate(session.id);
                }
              }}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(session.id);
                }
              }}
              onDragStart={(event) => {
                setDragId(session.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', session.id);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setOverId(session.id);
              }}
              onDragLeave={() => setOverId((current) => (current === session.id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                dropOn(session.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              className={cn(
                'group flex h-7 max-w-[210px] shrink-0 cursor-grab items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors active:cursor-grabbing',
                active
                  ? 'border-accent/50 bg-accent/10 text-ink shadow-[inset_0_-2px_0_rgb(107_150_255/0.55)]'
                  : 'border-transparent text-muted hover:border-line hover:bg-panel2/60 hover:text-ink',
                dragId === session.id && 'opacity-45',
                overId === session.id && dragId !== session.id && 'ring-1 ring-accent/70',
              )}
            >
              <Icon name={tool?.icon ?? 'panel'} size={11} className={cn('shrink-0', active ? 'text-accent' : 'text-muted/75')} />
              {editing ? (
                <input
                  autoFocus
                  value={draft}
                  maxLength={80}
                  aria-label={t('session.rename')}
                  className="mono min-w-0 flex-1 rounded border border-accent/40 bg-panel px-1 py-0 text-[11px] outline-none"
                  onClick={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => commitRename(session)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitRename(session);
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      setEditingId(null);
                    }
                  }}
                />
              ) : (
                <span
                  className="min-w-0 truncate"
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    startRename(session);
                  }}
                >
                  {session.name || labelFor(tool, 'Sesi')}
                </span>
              )}
              <button
                type="button"
                aria-label={t('session.close')}
                title={t('session.close')}
                className="ml-0.5 shrink-0 rounded p-0.5 text-muted/55 opacity-70 transition-colors hover:bg-bad/10 hover:text-bad group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(session.id);
                }}
              >
                <Icon name="x" size={9} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="relative shrink-0">
        <button
          type="button"
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-panel2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
          onClick={() => setAddOpen((open) => !open)}
          disabled={sessions.length >= max}
          aria-label={t('session.add')}
          aria-haspopup="menu"
          aria-expanded={addOpen}
          title={sessions.length >= max ? t('session.max') : t('session.add')}
        >
          <Icon name="plus" size={13} />
        </button>
        {addOpen ? (
          <div
            role="menu"
            className="absolute top-full right-0 z-50 mt-1 max-h-80 w-60 overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-[0_24px_70px_-24px_rgb(0_0_0/0.9)]"
          >
            <div className="px-2 py-1.5 text-[10px] font-semibold tracking-wide text-muted uppercase">
              {t('session.addTool')}
            </div>
            {tools.map((tool) => (
              <button
                key={tool.id}
                type="button"
                role="menuitem"
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] text-ink/85 transition-colors hover:bg-panel2 hover:text-ink"
                onClick={() => {
                  onAdd(tool.id);
                  setAddOpen(false);
                }}
              >
                <Icon name={tool.icon} size={12} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">{labelFor(tool, tool.label)}</span>
                <span className="text-[9.5px] text-muted/50">{tool.id}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
