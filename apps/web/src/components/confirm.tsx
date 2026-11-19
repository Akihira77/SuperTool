import { createContext, useCallback, useContext, useId, useRef, useState, type ReactNode } from 'react';
import { Button, Dialog, Icon } from './ui';
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
 * Konfirmasi pengganti window.confirm: modal sendiri, fokus awal di tombol
 * batal, Enter/Space mengaktifkan tombol yang sedang fokus (bukan selalu setuju),
 * Escape membatalkan, dan fokus kembali ke pemicu setelah ditutup.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const messageId = useId();

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolver.current?.(false);
      resolver.current = resolve;
      setState(options);
    });
  }, []);

  const close = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setState(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state ? (
        <Dialog
          open
          onClose={() => close(false)}
          role="alertdialog"
          size="md"
          initialFocusRef={cancelRef}
          labelledBy="confirm-title"
          describedBy={state.message ? messageId : undefined}
          className="gap-3 p-4"
        >
          <div className="flex items-start gap-2">
            <span
              className={
                'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-control ' +
                (state.danger ? 'bg-bad/15 text-bad' : 'bg-accent/15 text-accent')
              }
            >
              <Icon name={state.danger ? 'trash' : 'check'} size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <div id="confirm-title" className="text-[14px] font-medium text-ink">
                {state.title}
              </div>
              {state.message ? (
                <p id={messageId} className="mt-1 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-muted">
                  {state.message}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button ref={cancelRef} onClick={() => close(false)}>
              {state.cancelLabel ?? t('common.cancel')}
            </Button>
            <Button variant={state.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {state.confirmLabel ?? t('common.confirm')}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
