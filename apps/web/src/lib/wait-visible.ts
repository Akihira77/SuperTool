/** Elemen dianggap siap difokuskan hanya jika benar-benar terlihat. */
export function isVisible(node: HTMLElement): boolean {
  if (!node.getClientRects().length) return false;
  const style = getComputedStyle(node);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

/**
 * Tunggu target muncul dan terlihat, dibatasi MutationObserver + interval ringan,
 * tanpa rantai setTimeout dan tanpa selector global. AbortSignal membatalkan
 * permintaan lama saat pengguna berpindah konteks.
 */
export function waitForVisibleTarget(
  root: HTMLElement,
  selector: string,
  signal: AbortSignal,
  timeoutMs = 5000,
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (node: HTMLElement | null) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearInterval(interval);
      window.clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(node);
    };
    // Selector yang dikirim registry adalah sufiks data-action, bukan selector CSS.
    const query = '[data-action="' + CSS.escape(selector) + '"]';
    const check = () => {
      const node = root.querySelector<HTMLElement>(query);
      if (node && isVisible(node)) finish(node);
    };
    const onAbort = () => finish(null);
    const observer = new MutationObserver(check);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
    const interval = window.setInterval(check, 120);
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    check();
  });
}
