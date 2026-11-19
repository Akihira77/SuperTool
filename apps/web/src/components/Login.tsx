import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Button, Field, Icon, PasswordInput } from './ui';

export default function Login({ onSuccess }: { onSuccess: (mustChange: boolean) => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.post<{ mustChange: boolean }>('/auth/login', { password });
      onSuccess(result.mustChange);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('login.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_0%,rgba(107,150,255,0.16),transparent_70%)]" />
      <form onSubmit={submit} className="card relative w-full max-w-[380px] rounded-panel p-7 shadow-elev-3">
        <div className="mb-7 flex items-center gap-3.5">
          <div className="flex size-11 items-center justify-center rounded-[13px] border border-accent/30 bg-gradient-to-br from-accent to-accent2 text-white shadow-[0_12px_30px_-16px_rgb(107_150_255/0.9)]">
            <Icon name="lock" size={20} />
          </div>
          <div>
            <h1 className="text-[17px] font-semibold tracking-tight">Super Tool</h1>
            <p className="mt-0.5 text-[12.5px] text-muted">{t('login.subtitle')}</p>
          </div>
        </div>

        <Field id="login-password" label="Password" className="mb-1.5">
          <PasswordInput
            id="login-password"
            autoFocus
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            label="Password"
            autoComplete="current-password"
          />
        </Field>

        {error ? (
          <p role="alert" className="mt-3 rounded-control border border-bad/25 bg-bad/10 px-2.5 py-2 text-[12.5px] text-bad">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          icon="lock"
          loading={busy}
          disabled={!password}
          className="mt-5 w-full justify-center py-2.5"
        >
          {t('login.submit')}
        </Button>

        <p className="mt-4 text-center text-[12px] leading-relaxed text-muted">
          {t('login.firstTime')} <span className="mono text-ink/80">password</span>, {t('login.changeHint')}
        </p>
      </form>
    </div>
  );
}
