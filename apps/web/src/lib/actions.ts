/**
 * Registry aksi lintas tool untuk command palette.
 *
 * Metadata tinggal di sini (id, tool, ikon, target fokus). Eksekusi tetap
 * generik: palette membuka sesi tool lalu mengklik tombol ber-atribut
 * data-action="tool:aksi", sehingga tiap tool tidak perlu tahu soal palette.
 */
export type ToolAction = {
  tool: string;
  action: string;
  icon: string;
  /** Fokus elemen setelah tool tampil, bukan klik tombol. */
  focus?: string;
};

export const TOOL_ACTIONS: readonly ToolAction[] = [
  { tool: 'markdown', action: 'write', icon: 'markdown', focus: 'editor' },
  { tool: 'markdown', action: 'upload', icon: 'download' },
  { tool: 'markdown', action: 'export', icon: 'download' },
  { tool: 'markdown', action: 'sample', icon: 'notes' },
  { tool: 'markdown', action: 'clear', icon: 'trash' },
  { tool: 'json', action: 'write', icon: 'json', focus: 'editor' },
  { tool: 'json', action: 'format', icon: 'check' },
  { tool: 'json', action: 'minify', icon: 'compress' },
  { tool: 'json', action: 'sort', icon: 'types' },
  { tool: 'json', action: 'upload', icon: 'download' },
  { tool: 'json', action: 'download', icon: 'download' },
  { tool: 'types', action: 'download', icon: 'download' },
  { tool: 'notes', action: 'new', icon: 'plus' },
  { tool: 'notes', action: 'search', icon: 'search', focus: 'search' },
  { tool: 'notes', action: 'delete', icon: 'trash' },
  { tool: 'notes', action: 'list', icon: 'notes' },
  { tool: 'nginx', action: 'save', icon: 'save' },
  { tool: 'nginx', action: 'new', icon: 'plus' },
  { tool: 'ports', action: 'refresh', icon: 'refresh' },
  { tool: 'ports', action: 'tabPorts', icon: 'ports' },
  { tool: 'ports', action: 'tabProcs', icon: 'dev' },
  { tool: 'ports', action: 'auto', icon: 'play' },
  { tool: 'compress', action: 'pick', icon: 'files' },
  { tool: 'compress', action: 'run', icon: 'play' },
  { tool: 'compress', action: 'download', icon: 'download' },
  { tool: 'webhook', action: 'pause', icon: 'play' },
  { tool: 'webhook', action: 'clear', icon: 'trash' },
  { tool: 'settings', action: 'backup', icon: 'download' },
  { tool: 'settings', action: 'restore', icon: 'upload' },
  ...['regex', 'encode', 'http', 'log', 'docker', 'git', 'cron', 'dns', 'sqlite', 'audit'].map<ToolAction>((action) => ({
    tool: 'devspace',
    action,
    icon: 'chevronRight',
  })),
];

export function actionsFor(tool: string): ToolAction[] {
  return TOOL_ACTIONS.filter((action) => action.tool === tool);
}

export function findAction(tool: string, action: string): ToolAction | undefined {
  return TOOL_ACTIONS.find((item) => item.tool === tool && item.action === action);
}
