import { useState } from 'react';
import { CopyButton, Icon, Spinner, cn } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

type Mode = 'konversi' | 'url' | 'html' | 'jwt';
type Enc = 'text' | 'base64' | 'base64url' | 'hex';

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'konversi', label: 'Konversi' },
  { id: 'url', label: 'URL' },
  { id: 'html', label: 'HTML entity' },
  { id: 'jwt', label: 'JWT decode' },
];

const ENCS: Array<{ id: Enc; label: string }> = [
  { id: 'text', label: 'Teks' },
  { id: 'base64', label: 'Base64' },
  { id: 'base64url', label: 'Base64 URL-safe' },
  { id: 'hex', label: 'Hex' },
];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBytes(text: string, enc: Enc): Uint8Array {
  if (enc === 'text') return encoder.encode(text);
  const clean = text.replace(/\s+/g, '');
  if (enc === 'hex') {
    if (!/^[0-9a-f]*$/i.test(clean) || clean.length % 2) throw new Error('Hex tidak valid');
    return Uint8Array.from(clean.match(/.{2}/g) ?? [], (pair) => parseInt(pair, 16));
  }
  const normal = enc === 'base64url' ? clean.replace(/-/g, '+').replace(/_/g, '/') : clean;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normal)) throw new Error('Base64 tidak valid');
  const raw = atob(normal);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function fromBytes(bytes: Uint8Array, enc: Enc): string {
  if (enc === 'text') return decoder.decode(bytes);
  if (enc === 'hex') return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base = btoa(binary);
  return enc === 'base64url' ? base.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : base;
}

function convert(text: string, from: Enc, to: Enc): string {
  if (!text) return '';
  return fromBytes(toBytes(text, from), to);
}

function transform(mode: Mode, text: string, decode: boolean): string {
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
  const dec = (chunk: string) => JSON.parse(decoder.decode(toBytes(chunk, 'base64url')));
  return JSON.stringify({ header: dec(parts[0]), payload: dec(parts[1]) }, null, 2);
}

export default function EncodeTab() {
  const [mode, setMode] = useState<Mode>('konversi');
  const [from, setFrom] = useState<Enc>('text');
  const [to, setTo] = useState<Enc>('base64');
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
      setOutput(mode === 'konversi' ? convert(input, from, to) : transform(mode, input, decode));
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
              onClick={() => {
                setMode(item.id);
                setOutput('');
                setError('');
              }}
              className={cn('chip cursor-pointer', mode === item.id && 'border-accent/60 bg-accent/15 text-accent')}
            >
              {item.label}
            </button>
          ))}
        </div>

        {mode === 'konversi' ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] tracking-wide text-muted uppercase">Dari</span>
              <select value={from} onChange={(event) => setFrom(event.target.value as Enc)} className="input w-auto cursor-pointer py-1">
                {ENCS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn cursor-pointer px-2"
              title="Tukar arah"
              onClick={() => {
                setFrom(to);
                setTo(from);
                setInput(output);
                setOutput('');
              }}
            >
              <Icon name="refresh" size={13} />
            </button>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] tracking-wide text-muted uppercase">Ke</span>
              <select value={to} onChange={(event) => setTo(event.target.value as Enc)} className="input w-auto cursor-pointer py-1">
                {ENCS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <label className="flex min-h-0 flex-1 flex-col gap-1">
          <span className="text-[11px] tracking-wide text-muted uppercase">Input</span>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
            placeholder={mode === 'jwt' ? 'eyJhbGciOi...' : mode === 'konversi' ? 'teks / base64 / hex' : 'teks di sini'}
            className="input mono min-h-[200px] flex-1 resize-none"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          {mode === 'url' || mode === 'html' ? (
            <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted">
              <input type="checkbox" checked={decode} onChange={(event) => setDecode(event.target.checked)} />
              Mode decode
            </label>
          ) : null}
          <button type="button" className="btn btn-primary cursor-pointer" onClick={run}>
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
            <select value={algo} onChange={(event) => setAlgo(event.target.value)} className="input w-auto cursor-pointer py-1">
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
            <button type="button" className="btn cursor-pointer" onClick={() => void runHash()} disabled={!input}>
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
