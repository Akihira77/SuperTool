import { useCallback, useState } from 'react';

/** Panel samping yang bisa disembunyikan; pilihan disimpan per panel. */
export function useSidebar(key: string, initial = true): [boolean, () => void] {
  const storageKey = 'st:panel:' + key;
  const [open, setOpen] = useState(() => {
    const saved = localStorage.getItem(storageKey);
    return saved === null ? initial : saved === '1';
  });
  const toggle = useCallback(() => {
    setOpen((prev) => {
      localStorage.setItem(storageKey, prev ? '0' : '1');
      return !prev;
    });
  }, [storageKey]);
  return [open, toggle];
}
