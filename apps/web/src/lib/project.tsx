import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

const KEY = 'st:project';
const RECENT_KEY = 'st:project:recent';
const MAX_RECENT = 8;

const readRecent = (): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === 'string').map(cleanPath).slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
};

/** Normalisasi path absolut agar `//////home/x` tidak tampil sebagai breadcrumb rusak. */
export const cleanPath = (path: string) => (path ? '/' + path.split('/').filter(Boolean).join('/') : '');

/** Cek path berada di root; root `/` butuh penanganan khusus agar tidak jadi `//`. */
export const isInside = (path: string, root: string) =>
  root === '/' ? path.startsWith('/') : path === root || path.startsWith(root + '/');

type ProjectContext = {
  projectPath: string;
  setProject: (path: string) => void;
  clearProject: () => void;
  recent: string[];
  forget: (path: string) => void;
};

const Ctx = createContext<ProjectContext>({
  projectPath: '',
  setProject: () => undefined,
  clearProject: () => undefined,
  recent: [],
  forget: () => undefined,
});

/** Folder proyek aktif — opsional; kosong berarti tool memakai folder default seperti sebelumnya. */
export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projectPath, setPath] = useState(() => {
    try {
      return cleanPath(localStorage.getItem(KEY) ?? '');
    } catch {
      return '';
    }
  });
  const [recent, setRecent] = useState<string[]>(readRecent);

  const setProject = useCallback((path: string) => {
    const nextPath = cleanPath(path);
    setPath(nextPath);
    try {
      localStorage.setItem(KEY, nextPath);
    } catch {
      // localStorage penuh/private mode: pilihan tetap berlaku untuk sesi ini
    }
    if (!nextPath) return;
    setRecent((prev) => {
      const next = [nextPath, ...prev.filter((item) => item !== nextPath)].slice(0, MAX_RECENT);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // abaikan
      }
      return next;
    });
  }, []);

  const clearProject = useCallback(() => setProject(''), [setProject]);

  const forget = useCallback((path: string) => {
    setRecent((prev) => {
      const next = prev.filter((item) => item !== path);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // abaikan
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ projectPath, setProject, clearProject, recent, forget }), [projectPath, setProject, clearProject, recent, forget]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useProject = () => useContext(Ctx);

export const projectName = (path: string) => path.split('/').filter(Boolean).pop() ?? path;
