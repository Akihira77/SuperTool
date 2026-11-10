import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled]), [role="option"]:not([aria-disabled="true"])';

function enabledItems(menu: HTMLElement | null): HTMLElement[] {
  if (!menu) return [];
  return Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(
    (item) => item.offsetParent !== null || item === document.activeElement,
  );
}

/**
 * Perilaku keyboard + dismiss untuk menu/listbox kustom.
 *
 * Trigger membuka dengan Enter/Space (native click) atau ArrowDown. Saat terbuka,
 * fokus masuk ke item terpilih/first, Arrow/Home/End berpindah, Escape menutup
 * dan mengembalikan fokus ke trigger, klik luar menutup tanpa merebut fokus.
 * Pemilik menu tetap menentukan apa yang terjadi saat item dipilih.
 */
export function useMenu(
  open: boolean,
  setOpen: (open: boolean) => void,
  triggerRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
) {
  const closeRef = useRef(setOpen);
  closeRef.current = setOpen;

  const closeAndRestore = useCallback(() => {
    closeRef.current(false);
    triggerRef.current?.focus();
  }, [triggerRef]);

  const onTriggerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        closeRef.current(true);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const frame = requestAnimationFrame(() => {
      const items = enabledItems(menu);
      const selected = menu?.querySelector<HTMLElement>('[aria-selected="true"]');
      (selected ?? items[0] ?? menu)?.focus();
    });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeAndRestore();
        return;
      }
      if (event.key === 'Tab') {
        closeRef.current(false);
        return;
      }
      const items = enabledItems(menuRef.current);
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = current < 0 ? (delta > 0 ? 0 : items.length - 1) : (current + delta + items.length) % items.length;
        items[next]?.focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        items[0]?.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        items[items.length - 1]?.focus();
      }
    };

    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closeRef.current(false);
    };

    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [closeAndRestore, menuRef, open, triggerRef]);

  return { onTriggerKeyDown, closeAndRestore };
}
