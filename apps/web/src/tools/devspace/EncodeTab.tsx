import { useState } from 'react';
import { CopyButton, Icon, Spinner, cn } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

type Mode = 'base64' | 'url' | 'html' | 'jwt';

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'base64', label: 'Base64' },
  { id: 'url', label: 'URL' },
  { id: 'html', label: 'HTML entity' },
  { id: 'jwt', label: 'JWT decode' },
];

function b64Encode(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

function b64Decode(text: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(text.trim()), (char) => char.charCodeAt(0)));
}

function transform(mode: Mode, text: string, decode: boolean): string {
  if (mode === 'base64') return decode ? b64Decode(text) : b64Encode(text);
  if (mode === 'url') return decode ? decodeURIComponent(text) : encodeURIComponent(text);
  if (mode === 'html') {
    if (decode) {
      const node = document.createElement('textarea');
      node.innerHTML = text;
      return node.value;
    }
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const parts = text.trim().split('.');
  if (parts.length < 2) throw new Error('Bukan token JWT');
  const dec = (chunk: string) => JSON.parse(b64Decode(chunk.replace(/-/g, '+').replace(/_/g, '/')));
  return JSON.stringify({ header: dec(parts[0]), payload: dec(parts[1]) }, null, 2);
}

export default function EncodeTab() {
  const [mode, setMode] = useState<Mode>('base64');
  const [decode, setDecode] = useState(false);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [algo, setAlgo] = useState('sha256');
  const [hmacKey, setHmacKey] = useState('');
  const [hash, setHash] = useState('');
  const [busy, setBusy] = useState(false);

  const run = () => {
    setError('');
    try {
      setOutput(transform(mode, input, decode));
    } catch (err) {
      setOutput('');
      setError((err as Error).message);
    }
  };

  const runHash = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api.post<{ hex: string }>('/dev/hash', { text: input, algo, hmacKey: hmacKey || undefined });
      setHash(result.hex);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menghitung hash');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-4 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => { setMode(item.id); setOutput(''); setError(''); }}
              className={cn('chip cursor-pointer', mode === item.id && 'border-accent/60 bg-accent/15 text-accent')}
            >
              {item.label}
            </button>
          ))}
        </div>

        <label className="flex min-h-0 flex-1 flex-col gap-1">
          <span className="text-[11px] tracking-wide text-muted uppercase">Input</span>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
            placeholder={mode === 'jwt' ? 'eyJhbGciOi...' : 'teks di sini'}
            className="input mono min-h-[200px] flex-1 resize-none"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          {mode !== 'jwt' ? (
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              <input type="checkbox" checked={decode} onChange={(event) => setDecode(event.target.checked)} />
              Mode decode
            </label>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={run}>
            <Icon name="play" /> Jalankan
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-1">
            <span className="text-[11px] tracking-wide text-muted uppercase">Hasil</span>
            {output ? <CopyButton text={output} label="Salin hasil" /> : null}
          </div>
          <pre className="input mono min-h-[200px] flex-1 overflow-auto whitespace-pre-wrap">{output}</pre>
          {error ? <span className="text-[11.5px] text-bad">{error}</span> : null}
        </div>

        <div className="card flex flex-col gap-2 p-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] tracking-wide text-muted uppercase">Hash dari input</span>
            {busy ? <Spinner /> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={algo} onChange={(event) => setAlgo(event.target.value)} className="input w-auto py-1">
              {['md5', 'sha1', 'sha256', 'sha512', 'sha3-256'].map((item) => (
                <option key={item} value={item}>
                  {item.toUpperCase()}
                </option>
              ))}
            </select>
            <input
              value={hmacKey}
              onChange={(event) => setHmacKey(event.target.value)}
              placeholder="kunci HMAC (opsional)"
              className="input mono w-auto flex-1 py-1"
            />
            <button type="button" className="btn" onClick={() => void runHash()} disabled={!input}>
              <Icon name="check" /> Hitung
            </button>
          </div>
          {hash ? (
            <div className="flex items-center gap-2">
              <code className="mono flex-1 break-all rounded bg-panel2 px-2 py-1 text-[11.5px] text-ink/90">{hash}</code>
              <CopyButton text={hash} label="Hash" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
