import { useState, type ReactNode } from 'react';
import { useI18n } from '../lib/i18n';

export const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const PATHS: Record<string, string> = {
  markdown: 'M4 5h16v14H4z M7 15V9l2 3 2-3v6 M15 9v5h3',
  json: 'M9 4c-2 0-2 2-2 4s0 4-2 4c2 0 2 2 2 4s0 4 2 4 M15 4c2 0 2 2 2 4s0 4 2 4c-2 0-2 2-2 4s0 4-2 4',
  types: 'M8 4v16 M16 4v16 M8 9h8 M8 15h8 M4 4h16 M4 20h16',
  notes: 'M6 3h9l4 4v14H6z M15 3v4h4 M9 11h7 M9 15h7 M9 19h4',
  url: 'M12 3a9 9 0 100 18 9 9 0 000-18z M3 12h18 M12 3c2.5 2.5 2.5 15.5 0 18 M12 3c-2.5 2.5-2.5 15.5 0 18',
  nginx: 'M4 5h16v6H4z M4 13h16v6H4z M8 8h.01 M8 16h.01',
  ports: 'M3 12h4l2-6 3 12 3-9 2 3h4',
  files: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  plus: 'M12 5v14 M5 12h14',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  copy: 'M9 9h10v10H9z M5 15V5h10',
  save: 'M5 3h11l3 3v15H5z M8 3v6h7V3 M8 14h8v7H8z',
  refresh: 'M20 11a8 8 0 10-2.3 6M20 5v6h-6',
  calendar: 'M5 5h14v15H5z M8 3v4 M16 3v4 M5 10h14',
  clock: 'M12 4a8 8 0 100 16 8 8 0 000-16z M12 8v4l3 2',
  bell: 'M6 16v-5a6 6 0 1112 0v5 M4 16h16 M10 20a2 2 0 004 0',
  pin: 'M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z M12 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3',
  download: 'M12 4v11 M7 11l5 5 5-5 M4 20h16',
  upload: 'M12 20V9 M7 13l5-5 5 5 M4 4h16',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14z M20 20l-4-4',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  x: 'M6 6l12 12 M18 6L6 18',
  check: 'M5 13l4 4L19 7',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v5H5V6h5',
  edit: 'M4 20h4l10-10-4-4L4 16z M14 6l4 4',
  folderPlus: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z M12 11v5 M9.5 13.5h5',
  back: 'M15 6l-6 6 6 6',
  lock: 'M6 11h12v9H6z M9 11V8a3 3 0 016 0v3',
  logout: 'M15 4h4v16h-4 M11 12H3 M7 8l-4 4 4 4',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 9a3 3 0 100 6 3 3 0 000-6z',
  eyeOff: 'M3 3l18 18 M10.6 10.6a3 3 0 004.2 4.2 M6.5 6.7C4.3 8.1 2.8 10.2 2 12c1.5 2.6 5 7 10 7 1.5 0 2.9-.4 4.1-1 M17.9 17.1C20 15.7 21.4 13.6 22 12c-1.5-2.6-5-7-10-7-.8 0-1.6.1-2.3.3',
  play: 'M7 4l13 8-13 8z',
  maximize: 'M14 4h6v6 M20 4l-6 6 M10 20H4v-6 M4 20l6-6',
  minimize: 'M20 10h-6V4 M14 10l6-6 M4 14h6v6 M10 14L4 20',
  fullscreen: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
  fullscreenExit: 'M9 4v5H4 M15 4v5h5 M9 20v-5H4 M15 20v-5h5',
  music: 'M9 18V6l11-2v12 M9 18a3 3 0 11-6 0 3 3 0 016 0z M20 16a3 3 0 11-6 0 3 3 0 016 0z',
  pause: 'M9 5v14 M15 5v14',
  volume: 'M4 9v6h4l5 4V5L8 9H4z M17 9a4 4 0 010 6',
  panel: 'M3 4h18v16H3z M15 4v16',
  sort: 'M4 7h10 M4 12h7 M4 17h4 M17 5v14 M14 16l3 3 3-3',
  minify: 'M4 12h16 M8 6h8 M8 18h8',
  compress: 'M9 9H4V4 M15 15h5v5 M4 4l7 7 M20 20l-7-7',
  dev: 'M3 4h18v16H3z M7 9l3 3-3 3 M13 15h4',
  db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  webhook: 'M12 3v8 M8 7l4 4 4-4 M5 13h14v6H5z M8 16h.01 M12 16h.01 M16 16h.01',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
};

export function Icon({ name, size = 16, className }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? PATHS.files} />
    </svg>
  );
}

export function PasswordInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  label,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  label?: string;
  invalid?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={invalid || undefined}
        className={cn('input pr-10', invalid && 'border-bad')}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'}
        title={show ? 'Sembunyikan' : 'Tampilkan'}
        className="absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1.5 text-muted transition-colors hover:bg-panel2 hover:text-ink"
      >
        <Icon name={show ? 'eyeOff' : 'eye'} size={15} />
      </button>
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-3">
      <div className="min-w-0">
        <h1 className="truncate text-[15px] font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="truncate text-xs text-muted">{subtitle}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </header>
  );
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          return;
        }
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      <Icon name={done ? 'check' : 'copy'} />
      {done ? t('common.copied') : (label ?? t('common.copy'))}
    </button>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted">{text}</div>;
}

export function Spinner() {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted/30 border-t-accent [animation-duration:1.5s]" />
  );
}
