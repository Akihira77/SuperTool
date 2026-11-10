export type WorkspaceService = { name: string; url: string };
export type WorkspaceShortcut = { label: string; path: string };
export type WorkspaceConfig = {
  gitRepo?: string;
  favoriteUrls?: string[];
  services?: WorkspaceService[];
  tools?: string[];
  shortcuts?: WorkspaceShortcut[];
};
export type Workspace = {
  id: string;
  name: string;
  root: string;
  config: WorkspaceConfig;
  createdAt: number;
  updatedAt: number;
};

const ACTIVE_KEY = 'st:workspace:active';
const ROOT_KEY = 'st:workspace:root';

export function activeWorkspaceId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function activeWorkspaceRoot(): string | null {
  return localStorage.getItem(ROOT_KEY);
}

/** Simpan pilihan lokal lalu beri tahu File Explorer tanpa reload halaman. */
export function activateWorkspace(workspace: Workspace): void {
  localStorage.setItem(ACTIVE_KEY, workspace.id);
  localStorage.setItem(ROOT_KEY, workspace.root);
  localStorage.setItem('st:files:root', workspace.root);
  window.dispatchEvent(new CustomEvent<Workspace>('st:workspace', { detail: workspace }));
}

export function onWorkspace(handler: (workspace: Workspace) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<Workspace>).detail);
  window.addEventListener('st:workspace', listener);
  return () => window.removeEventListener('st:workspace', listener);
}
