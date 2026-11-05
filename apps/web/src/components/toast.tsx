import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Icon, cn } from './ui';

type Tone = 'ok' | 'error' | 'info';
type Toast = { id: number; message: string; tone: Tone };

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => undefined);

/**
 * Toast global minimal: satu provider, auto hilang 3,5 detik, klik untuk tutup.
 * ponytail: tanpa animasi masuk/keluar — cukup muncul, cukup hilang.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: Tone = 'info') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev.slice(-3), { id, message, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((item) => item.id !== id)), 3500);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setItems((prev) => prev.filter((entry) => entry.id !== item.id))}
            className={cn(
              'pointer-events-auto flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-left text-[12.5px] shadow-lg backdrop-blur',
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
