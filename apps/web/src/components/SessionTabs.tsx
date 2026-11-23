import { useEffect, useRef, useState } from 'react';
import { DropdownMenu, Icon, cn } from './ui';
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
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const addTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  const focusSession = (id: string) => {
    requestAnimationFrame(() => tabRefs.current.get(id)?.focus());
  };

  const closeSession = (id: string) => {
    const index = sessions.findIndex((session) => session.id === id);
    const neighbour = sessions[index + 1] ?? sessions[index - 1];
    onClose(id);
    requestAnimationFrame(() => {
      const button = neighbour ? tabRefs.current.get(neighbour.id) : undefined;
      (button ?? addTriggerRef.current)?.focus();
    });
  };

  const toolFor = (id: string) => tools.find((tool) => tool.id === id);
  const activeSession = sessions.find((session) => session.id === activeId);
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
      <p id="session-tabs-hint" className="sr-only">
        {t('session.keyboardHint')}
      </p>
      <div
        role="tablist"
        aria-label={t('session.listLabel')}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5"
      >
        {sessions.map((session, index) => {
          const tool = toolFor(session.tool);
          const active = session.id === activeId;
          const editing = session.id === editingId;
          return (
            <div
              key={session.id}
              ref={(node) => {
                if (active) activeRef.current = node;
              }}
              role="presentation"
              data-session-id={session.id}
              className={cn(
                'group flex h-7 max-w-[210px] shrink-0 items-center rounded-md border transition-colors',
                active
                  ? 'border-accent/50 bg-accent/10 text-ink shadow-[inset_0_-2px_0_rgb(107_150_255/0.55)]'
                  : 'border-transparent text-muted hover:border-line hover:bg-panel2/60 hover:text-ink',
                dragId === session.id && 'opacity-45',
                overId === session.id && dragId !== session.id && 'ring-1 ring-accent/70',
              )}
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
            >
              {editing ? (
                <input
                  autoFocus
                  value={draft}
                  maxLength={80}
                  aria-label={t('session.rename')}
                  className="mono mx-1 min-w-0 flex-1 rounded border border-accent/40 bg-panel px-1 py-0 text-[12px] outline-none"
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => commitRename(session)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitRename(session);
                      focusSession(session.id);
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      setEditingId(null);
                      focusSession(session.id);
                    }
                  }}
                />
              ) : (
                <button
                  ref={(node) => {
                    if (node) tabRefs.current.set(session.id, node);
                    else tabRefs.current.delete(session.id);
                  }}
                  type="button"
                  role="tab"
                  id={'session-tab-' + session.id}
                  aria-controls={'session-panel-' + session.id}
                  aria-selected={active}
                  aria-label={session.name || labelFor(tool, 'Sesi')}
                  aria-describedby="session-tabs-hint"
                  tabIndex={active ? 0 : -1}
                  draggable
                  title={t('session.renameHint')}
                  className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-2 text-left text-[12px] focus-visible:outline-none"
                  onClick={() => onActivate(session.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onActivate(session.id);
                      return;
                    }
                    if (event.key === 'F2') {
                      event.preventDefault();
                      startRename(session);
                      return;
                    }
                    if (event.key === 'Delete') {
                      event.preventDefault();
                      closeSession(session.id);
                      return;
                    }
                    const previous = sessions[index - 1];
                    const next = sessions[index + 1];
                    if (event.altKey && event.key === 'ArrowLeft' && previous) {
                      event.preventDefault();
                      onReorder(session.id, previous.id);
                      focusSession(previous.id);
                      onActivate(previous.id);
                      return;
                    }
                    if (event.altKey && event.key === 'ArrowRight' && next) {
                      event.preventDefault();
                      onReorder(session.id, next.id);
                      focusSession(next.id);
                      onActivate(next.id);
                      return;
                    }
                    let target: ToolSession | undefined;
                    if (event.key === 'ArrowLeft') target = previous;
                    else if (event.key === 'ArrowRight') target = next;
                    else if (event.key === 'Home') target = sessions[0];
                    else if (event.key === 'End') target = sessions[sessions.length - 1];
                    if (!target) return;
                    event.preventDefault();
                    onActivate(target.id);
                    focusSession(target.id);
                  }}
                  onAuxClick={(event) => {
                    if (event.button === 1) {
                      event.preventDefault();
                      closeSession(session.id);
                    }
                  }}
                  onDragStart={(event) => {
                    setDragId(session.id);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', session.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                >
                  <Icon name={tool?.icon ?? 'panel'} size={13} className={cn('shrink-0', active ? 'text-accent' : 'text-muted/75')} />
                  <span
                    className="min-w-0 truncate"
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      startRename(session);
                    }}
                  >
                    {session.name || labelFor(tool, 'Sesi')}
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>
      {/* Tombol tutup tidak boleh jadi anak tablist; kontrolnya dipasang di
          toolbar dan tetap menjangkau sesi aktif lewat keyboard (Delete). */}
      <button
        type="button"
        aria-label={t('session.close') + (activeSession ? ': ' + (activeSession.name || labelFor(toolFor(activeSession.tool), 'Sesi')) : '')}
        title={t('session.close')}
        data-action="session:close-active"
        disabled={!activeSession}
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded text-muted/70 transition-colors hover:bg-bad/15 hover:text-bad disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted/70"
        onClick={() => {
          if (activeSession) closeSession(activeSession.id);
        }}
      >
        <Icon name="x" size={12} />
      </button>
      <div className="relative shrink-0">
        <DropdownMenu
          menuId="session-add-menu"
          label={t('session.addTool')}
          triggerIcon="plus"
          triggerAriaLabel={t('session.add')}
          triggerTitle={sessions.length >= max ? t('session.max') : t('session.add')}
          triggerDisabled={sessions.length >= max}
          triggerRef={addTriggerRef}
          triggerSize="lg"
          entries={[
            { id: 'session-add-label', type: 'label', label: t('session.addTool') },
            ...tools.map((tool) => ({
              id: tool.id,
              type: 'item' as const,
              label: labelFor(tool, tool.label),
              icon: tool.icon,
              shortcut: tool.id,
              onSelect: () => onAdd(tool.id),
            })),
          ]}
        />
      </div>
    </div>
  );
}