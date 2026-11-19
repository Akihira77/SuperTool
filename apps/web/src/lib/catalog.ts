import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import {
  MAX_SESSIONS,
  loadSessionStore,
  newSession,
  type SessionStore,
} from './sessions';

export type ToolGroup = 'workspace' | 'build' | 'ops';
export type Tool = {
  id: string;
  label: string;
  desc: string;
  icon: string;
  group: ToolGroup;
  component: LazyExoticComponent<ComponentType>;
};

export const TOOLS: Array<Tool & { key: string }> = [
  { id: 'markdown', key: 'nav.markdown', label: 'Markdown', desc: 'Editor + live preview', icon: 'markdown', group: 'workspace', component: lazy(() => import('../tools/MarkdownTool')) },
  { id: 'notes', key: 'nav.notes', label: 'Catatan', desc: 'Notepad tersimpan', icon: 'notes', group: 'workspace', component: lazy(() => import('../tools/NotesTool')) },
  { id: 'files', key: 'nav.files', label: 'File Explorer', desc: 'Jelajah & lihat file', icon: 'files', group: 'workspace', component: lazy(() => import('../tools/FilesTool')) },
  { id: 'viewer', key: 'nav.viewer', label: 'URL Viewer', desc: 'Buka tool lain via iframe', icon: 'url', group: 'workspace', component: lazy(() => import('../tools/UrlTool')) },
  { key: 'nav.json', id: 'json', label: 'JSON', desc: 'Formatter & beautify', icon: 'json', group: 'build', component: lazy(() => import('../tools/JsonTool')) },
  { key: 'nav.types', id: 'types', label: 'JSON ke TS', desc: 'Generate tipe TypeScript', icon: 'types', group: 'build', component: lazy(() => import('../tools/TypesTool')) },
  { key: 'nav.compress', id: 'compress', label: 'Kompresor', desc: 'Perkecil PDF & gambar', icon: 'compress', group: 'build', component: lazy(() => import('../tools/CompressTool')) },
  { key: 'nav.downloader', id: 'downloader', label: 'Downloader', desc: 'YouTube, Facebook, Bilibili', icon: 'download', group: 'build', component: lazy(() => import('../tools/DownloaderTool')) },
  { key: 'nav.devspace', id: 'devspace', label: 'Dev Space', desc: 'Regex, hash, HTTP, log, docker, git', icon: 'dev', group: 'ops', component: lazy(() => import('../tools/DevSpaceTool')) },
  { key: 'nav.storage', id: 'storage', label: 'Storage Monitor', desc: 'Pemakaian disk & bersihkan', icon: 'storage', group: 'ops', component: lazy(() => import('../tools/StorageTool')) },
  { key: 'nav.nginx', id: 'nginx', label: 'Nginx', desc: 'Edit konfigurasi', icon: 'nginx', group: 'ops', component: lazy(() => import('../tools/NginxTool')) },
  { key: 'nav.ports', id: 'ports', label: 'Port', desc: 'App yang sedang jalan', icon: 'ports', group: 'ops', component: lazy(() => import('../tools/PortsTool')) },
  { key: 'nav.webhook', id: 'webhook', label: 'Webhook Receiver', desc: 'Tangkap request HTTP masuk', icon: 'webhook', group: 'ops', component: lazy(() => import('../tools/WebhookTool')) },
  { key: 'nav.calendar', id: 'calendar', label: 'Calendar', desc: 'Agenda Google Calendar', icon: 'calendar', group: 'ops', component: lazy(() => import('../tools/CalendarTool')) },
  { key: 'nav.settings', id: 'settings', label: 'Settings', desc: 'Backup & restore data', icon: 'save', group: 'ops', component: lazy(() => import('../tools/SettingsTool')) },
];

export const GROUPS: Array<{ id: ToolGroup; key: 'nav.group.workspace' | 'nav.group.build' | 'nav.group.ops' }> = [
  { id: 'workspace', key: 'nav.group.workspace' },
  { id: 'build', key: 'nav.group.build' },
  { id: 'ops', key: 'nav.group.ops' },
];

export function toolById(id: string): Tool | undefined {
  return TOOLS.find((tool) => tool.id === id);
}

/** Satu sesi per tool; buang tool yang sudah tidak ada di katalog. */
export function normalizeSessions(store: SessionStore): SessionStore {
  const seen = new Set<string>();
  const sessions = store.sessions
    .filter((session) => {
      if (!toolById(session.tool) || seen.has(session.tool)) return false;
      seen.add(session.tool);
      return true;
    })
    .slice(0, MAX_SESSIONS);
  const activeId = sessions.some((session) => session.id === store.activeId)
    ? store.activeId
    : sessions[0]?.id ?? null;
  return { sessions, activeId };
}

export function initialSessionStore(route: string): SessionStore {
  const stored = loadSessionStore();
  if (stored) {
    const clean = normalizeSessions(stored);
    if (clean.sessions.length || !stored.sessions.length) return clean;
  }
  const tool = toolById(route) ?? TOOLS[0];
  const session = newSession(tool.id);
  return { sessions: [session], activeId: session.id };
}
