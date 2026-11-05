import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Icon, PasswordInput, Spinner } from './ui';

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
    <div className="flex h-full items-center justify-center bg-[radial-gradient(60%_50%_at_50%_0%,rgba(91,140,255,0.13),transparent)] p-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-7 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <Icon name="lock" size={20} />
          </div>
          <div>
            <h1 className="text-base font-semibold">Super Tool</h1>
            <p className="text-xs text-muted">Masuk untuk melanjutkan</p>
          </div>
        </div>

        <label className="mb-1.5 block text-xs font-medium text-muted">Password</label>
        <PasswordInput autoFocus value={password} onChange={setPassword} placeholder="••••••••" label="Password" />

        {error ? <p className="mt-3 text-xs text-bad">{error}</p> : null}

        <button type="submit" disabled={busy || !password} className="btn btn-primary mt-5 w-full justify-center py-2">
          {busy ? <Spinner /> : <Icon name="lock" />}
          Masuk
        </button>

        <p className="mt-4 text-center text-[11px] text-muted">
          Pertama kali? Password default <span className="mono text-ink/80">password</span>, lalu wajib diganti.
        </p>
      </form>
    </div>
  );
}
