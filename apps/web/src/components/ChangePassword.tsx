import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Button, Field, Icon, PasswordInput } from './ui';

export default function ChangePassword({ onDone, forced }: { onDone: () => void; forced: boolean }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < 8;
  const ready = Boolean(current) && Boolean(next) && Boolean(confirm) && !mismatch && !tooShort;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!confirm) {
      setError(t('password.repeatFirst'));
      return;
    }
    if (mismatch) {
      setError(t('password.mismatchError'));
      return;
    }
    if (next.length < 8) {
      setError(t('password.shortError'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/change-password', { current, next });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('password.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_0%,rgba(251,191,36,0.08),transparent_70%)]" />
      <form onSubmit={submit} className="card relative w-full max-w-[380px] rounded-panel p-7 shadow-elev-3">
        <div className="mb-6 flex items-center gap-3.5">
          <div className="flex size-11 items-center justify-center rounded-popover border border-warn/25 bg-warn/10 text-warn">
            <Icon name="lock" size={20} />
          </div>
          <div>
            <h1 className="text-[17px] font-semibold tracking-tight">{t('password.title')}</h1>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{forced ? t('password.forced') : t('password.subtitle')}</p>
          </div>
        </div>

        <div className="space-y-3">
          <Field id="cp-current" label={t('password.current')}>
            <PasswordInput
              id="cp-current"
              autoFocus
              value={current}
              onChange={setCurrent}
              label={t('password.current')}
              autoComplete="current-password"
            />
          </Field>
          <Field
            id="cp-next"
            label={t('password.next')}
            error={tooShort ? t('password.tooShort') : undefined}
          >
            <PasswordInput
              id="cp-next"
              value={next}
              onChange={setNext}
              placeholder={t('password.placeholder')}
              invalid={tooShort}
              label={t('password.next')}
              autoComplete="new-password"
              describedBy={tooShort ? 'cp-next-error' : undefined}
            />
          </Field>
          <Field id="cp-confirm" label={t('password.confirm')} error={mismatch ? t('password.mismatch') : undefined}>
            <PasswordInput
              id="cp-confirm"
              value={confirm}
              onChange={setConfirm}
              invalid={mismatch}
              label={t('password.confirm')}
              autoComplete="new-password"
              describedBy={mismatch ? 'cp-confirm-error' : undefined}
            />
          </Field>
        </div>

        {error ? (
          <p role="alert" className="mt-3 rounded-control border border-bad/25 bg-bad/10 px-2.5 py-2 text-[12.5px] text-bad">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          icon="check"
          loading={busy}
          disabled={!ready}
          className="mt-5 w-full justify-center py-2.5"
        >
          {t('password.save')}
        </Button>
      </form>
    </div>
  );
}
