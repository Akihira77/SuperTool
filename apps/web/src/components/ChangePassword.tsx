import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Icon, PasswordInput, Spinner } from './ui';

export default function ChangePassword({ onDone, forced }: { onDone: () => void; forced: boolean }) {
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
      setError('Ulangi password baru dulu');
      return;
    }
    if (mismatch) {
      setError('Konfirmasi password tidak sama');
      return;
    }
    if (next.length < 8) {
      setError('Password baru minimal 8 karakter');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/change-password', { current, next });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-7 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-warn/15 text-warn">
            <Icon name="lock" size={20} />
          </div>
          <div>
            <h1 className="text-base font-semibold">Ganti password</h1>
            <p className="text-xs text-muted">{forced ? 'Wajib diganti sebelum memakai tool' : 'Perbarui password akun'}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Password lama</label>
            <PasswordInput autoFocus value={current} onChange={setCurrent} label="Password lama" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Password baru</label>
            <PasswordInput value={next} onChange={setNext} placeholder="minimal 8 karakter" invalid={tooShort} label="Password baru" />
            {tooShort ? <p className="mt-1 text-[11px] text-bad">Minimal 8 karakter</p> : null}
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Ulangi password baru</label>
            <PasswordInput value={confirm} onChange={setConfirm} invalid={mismatch} label="Ulangi password baru" />
            {mismatch ? <p className="mt-1 text-[11px] text-bad">Belum sama dengan password baru</p> : null}
          </div>
        </div>

        {error ? <p className="mt-3 text-xs text-bad">{error}</p> : null}

        <button type="submit" disabled={busy || !ready} className="btn btn-primary mt-5 w-full justify-center py-2">
          {busy ? <Spinner /> : <Icon name="check" />}
          Simpan password
        </button>
      </form>
    </div>
  );
}
