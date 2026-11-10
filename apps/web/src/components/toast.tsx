import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, cn } from './ui';
import { bindNotifier } from '../lib/notify';

type Tone = 'ok' | 'error' | 'info';
type Toast = { id: number; message: string; tone: Tone };

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => undefined);

/**
 * Toast global: auto hilang (error 6 detik), klik untuk tutup, dedupe pesan kembar.
 * Juga jadi tujuan `notify()` untuk error API non-React.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const last = useRef<{ message: string; tone: Tone; at: number }>({ message: '', tone: 'info', at: 0 });

  const push = useCallback((message: string, tone: Tone = 'info') => {
    const now = Date.now();
    // Hindari toast kembar saat beberapa request gagal bersamaan.
    if (last.current.message === message && last.current.tone === tone && now - last.current.at < 1200) return;
    last.current = { message, tone, at: now };
    const id = now + Math.random();
    setItems((prev) => [...prev.slice(-3), { id, message, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((item) => item.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);

  useEffect(() => {
    bindNotifier(push);
    return () => bindNotifier(null);
  }, [push]);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setItems((prev) => prev.filter((entry) => entry.id !== item.id))}
            className={cn(
              'pointer-events-auto flex animate-[toast-in_160ms_ease-out] cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-left text-[13.5px] shadow-lg backdrop-blur',
              item.tone === 'ok'
                ? 'border-ok/40 bg-ok/12 text-ok'
                : item.tone === 'error'
                  ? 'border-bad/40 bg-bad/12 text-bad'
                  : 'border-line bg-panel/95 text-ink',
            )}
          >
            <Icon name={item.tone === 'ok' ? 'check' : item.tone === 'error' ? 'x' : 'dev'} size={14} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{item.message}</span>
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
