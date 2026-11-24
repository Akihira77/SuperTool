import { useState } from 'react';
import { Button, Card, Checkbox, CopyButton, Field, IconButton, Input, SegmentedControl, Select, Spinner, Textarea } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useI18n } from '../../lib/i18n';

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

const ENC_OPTIONS = ENCS.map((item) => ({ value: item.id, label: item.label }));
const ALGO_OPTIONS = ['md5', 'sha1', 'sha256', 'sha512', 'sha3-256'].map((item) => ({ value: item, label: item.toUpperCase() }));

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
  const { t } = useI18n();
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
      setError(err instanceof ApiError ? err.message : t('err.hash'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-4 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <SegmentedControl
          label="Mode"
          value={mode}
          onChange={(next) => {
            setMode(next);
            setOutput('');
            setError('');
          }}
          items={MODES}
          className="self-start"
        />

        {mode === 'konversi' ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field id="encode-from" label="Dari" className="w-40">
              <Select id="encode-from" value={from} onChange={setFrom} options={ENC_OPTIONS} size="sm" />
            </Field>
            <IconButton
              icon="refresh"
              label="Tukar arah"
              size="md"
              onClick={() => {
                setFrom(to);
                setTo(from);
                setInput(output);
                setOutput('');
              }}
            />
            <Field id="encode-to" label="Ke" className="w-40">
              <Select id="encode-to" value={to} onChange={setTo} options={ENC_OPTIONS} size="sm" />
            </Field>
          </div>
        ) : null}

        <Field id="encode-input" label="Input" className="min-h-0 flex-1">
          <Textarea
            id="encode-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
            placeholder={mode === 'jwt' ? 'eyJhbGciOi...' : mode === 'konversi' ? 'teks / base64 / hex' : 'teks di sini'}
            className="mono min-h-[200px] flex-1 resize-none"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          {mode === 'url' || mode === 'html' ? (
            <Checkbox label="Mode decode" checked={decode} onChange={(event) => setDecode(event.target.checked)} />
          ) : null}
          <Button variant="primary" icon="play" onClick={run}>
            {t('common.run')}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-1">
            <span className="field-label">Hasil</span>
            {output ? <CopyButton text={output} label="Salin hasil" /> : null}
          </div>
          <pre className="input mono min-h-[200px] flex-1 overflow-auto leading-relaxed whitespace-pre-wrap">{output}</pre>
          {error ? <span className="text-[12.5px] text-bad">{error}</span> : null}
        </div>

        <Card className="flex flex-col gap-2 p-3">
          <div className="flex items-center gap-2">
            <span className="field-label">Hash dari input</span>
            {busy ? <Spinner /> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={algo} onChange={setAlgo} options={ALGO_OPTIONS} size="sm" className="w-32" label="Algoritma hash" />
            <Input
              value={hmacKey}
              onChange={(event) => setHmacKey(event.target.value)}
              placeholder="kunci HMAC (opsional)"
              aria-label={t('a11y.hmacKey')}
              className="mono min-w-0 flex-1 py-1"
            />
            <Button icon="check" onClick={() => void runHash()} disabled={!input}>
              Hitung
            </Button>
          </div>
          {hash ? (
            <div className="flex items-center gap-2">
              <code className="mono min-w-0 flex-1 break-all rounded bg-panel2 px-2 py-1 text-[12.5px] text-ink/90">{hash}</code>
              <CopyButton text={hash} label="Hash" />
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
