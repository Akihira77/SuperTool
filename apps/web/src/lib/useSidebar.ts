import { useCallback, useState } from 'react';

/** Panel samping yang bisa disembunyikan; pilihan disimpan per panel. */
export function useSidebar(key: string, initial = true): [boolean, () => void, (open: boolean) => void] {
  const storageKey = 'st:panel:' + key;
  const [open, setOpenState] = useState(() => {
    const saved = localStorage.getItem(storageKey);
    return saved === null ? initial : saved === '1';
  });
  const toggle = useCallback(() => {
    setOpenState((prev) => {
      localStorage.setItem(storageKey, prev ? '0' : '1');
      return !prev;
    });
  }, [storageKey]);
  const setOpen = useCallback((next: boolean) => {
    localStorage.setItem(storageKey, next ? '1' : '0');
    setOpenState(next);
  }, [storageKey]);
  return [open, toggle, setOpen];
}
