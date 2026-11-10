import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, cn } from './ui';
import { useI18n } from '../lib/i18n';

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(() => Promise.resolve(false));

/**
 * Konfirmasi pengganti window.confirm: modal sendiri, bisa ditutup Esc,
 * Enter = setuju, dan fokus awal ada di tombol batal supaya aman.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setState(options);
    });
  }, []);

  const close = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setState(null);
  }, []);

  useEffect(() => {
    if (!state) return;
    const timer = setTimeout(() => cancelRef.current?.focus(), 20);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        close(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [close, state]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4" role="presentation" onMouseDown={() => close(false)}>
          <div
            className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-line bg-panel p-4 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-label={state.title}
          >
            <div className="flex items-start gap-2">
              <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg', state.danger ? 'bg-bad/15 text-bad' : 'bg-accent/15 text-accent')}>
                <Icon name={state.danger ? 'trash' : 'check'} size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-ink">{state.title}</div>
                {state.message ? <p className="mt-1 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-muted">{state.message}</p> : null}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button ref={cancelRef} type="button" className="btn cursor-pointer" onClick={() => close(false)}>
                {state.cancelLabel ?? t('common.cancel')}
              </button>
              <button
                type="button"
                className={cn('btn cursor-pointer', state.danger ? 'btn-danger' : 'btn-primary')}
                onClick={() => close(true)}
              >
                {state.confirmLabel ?? t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
