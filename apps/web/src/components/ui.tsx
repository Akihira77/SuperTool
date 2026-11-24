import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../lib/i18n';
import { useMenu } from '../lib/useMenu';
import { useFocusTrap } from '../lib/useFocusTrap';

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
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  folderPlus: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z M12 11v5 M9.5 13.5h5',
  back: 'M15 6l-6 6 6 6',
  lock: 'M6 11h12v9H6z M9 11V8a3 3 0 016 0v3',
  logout: 'M15 4h4v16h-4 M11 12H3 M7 8l-4 4 4 4',
  video: 'M15 10l4.55-2.27A1 1 0 0121 8.62v6.76a1 1 0 01-1.45.89L15 14 M4 6h9a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2',
  users: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8 M22 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 9a3 3 0 100 6 3 3 0 000-6z',
  eyeOff: 'M3 3l18 18 M10.6 10.6a3 3 0 004.2 4.2 M6.5 6.7C4.3 8.1 2.8 10.2 2 12c1.5 2.6 5 7 10 7 1.5 0 2.9-.4 4.1-1 M17.9 17.1C20 15.7 21.4 13.6 22 12c-1.5-2.6-5-7-10-7-.8 0-1.6.1-2.3.3',
  play: 'M7 4l13 8-13 8z',
  stop: 'M6 6h12v12H6z',
  restart: 'M20 11a8 8 0 10-2.3 6 M20 5v6h-6',
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
  storage: 'M4 5h16v5H4z M4 14h16v5H4z M7 7.5h.01 M7 16.5h.01 M17 7.5h.01 M17 16.5h.01',
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
  id,
  autoComplete,
  describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  label?: string;
  invalid?: boolean;
  id?: string;
  autoComplete?: string;
  describedBy?: string;
}) {
  const [show, setShow] = useState(false);
  const { t } = useI18n();
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn('input pr-10', invalid && 'border-bad')}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')}
        title={show ? t('auth.hidePassword') : t('auth.showPassword')}
        className="absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1.5 text-muted transition-colors hover:bg-panel2 hover:text-ink"
      >
        <Icon name={show ? 'eyeOff' : 'eye'} size={15} />
      </button>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-panel/25 px-4 py-3 backdrop-blur-sm md:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {icon ? (
          <span className="grid size-9 shrink-0 place-items-center rounded-[11px] border border-accent/20 bg-accent/10 text-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]">
            <Icon name={icon} size={17} />
          </span>
        ) : null}
        <div className="min-w-0">
          <h1 className="truncate text-[20px] leading-7 font-semibold tracking-[-0.015em]">{title}</h1>
          {subtitle ? <p className="mt-0.5 hidden max-w-[70vw] truncate text-[13px] text-muted sm:block">{subtitle}</p> : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 max-sm:w-full">{children}</div>
    </header>
  );
}

export function CopyButton({
  text,
  label,
  size = 'md',
}: {
  text: string;
  label?: string;
  size?: 'sm' | 'md';
}) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={cn('btn', size === 'sm' && 'btn-sm')}
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
      <Icon name={done ? 'check' : 'copy'} size={size === 'sm' ? 12 : 14} />
      {done ? t('common.copied') : (label ?? t('common.copy'))}
    </button>
  );
}

export function Empty({ text, icon, action }: { text: string; icon?: string; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-44 flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="grid size-11 place-items-center rounded-2xl border border-line bg-panel2/70 text-muted/80">
        <Icon name={icon ?? 'search'} size={19} />
      </span>
      <p className="max-w-sm text-[13.5px] leading-relaxed text-muted">{text}</p>
      {action}
    </div>
  );
}

export type TabItem<T extends string = string> = {
  id: T;
  label: string;
  icon?: string;
  action?: string;
  /** id panel yang dikendalikan tab; dipakai untuk aria-controls. */
  panelId?: string;
};

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: Array<TabItem<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const baseId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusTab = (index: number) => {
    const next = items[index];
    if (!next) return;
    onChange(next.id);
    refs.current[index]?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let target = -1;
    if (event.key === 'ArrowRight') target = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') target = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = items.length - 1;
    if (target < 0) return;
    event.preventDefault();
    focusTab(target);
  };

  return (
    <div role="tablist" aria-orientation="horizontal" className={cn('tabbar', className)}>
      {items.map((item, index) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            ref={(node) => { refs.current[index] = node; }}
            id={baseId + '-tab-' + item.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={item.panelId}
            tabIndex={active ? 0 : -1}
            data-action={item.action}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn('tab', active && 'tab-active')}
          >
            {item.icon ? <Icon name={item.icon} size={14} /> : null}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted/30 border-t-accent"
      style={{ animationDuration: '2.4s' }}
      aria-hidden="true"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

const BUTTON_VARIANTS = {
  default: '',
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  subtle: 'btn-subtle',
  danger: 'btn-danger',
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;

export function Button({
  variant = 'default',
  size = 'md',
  loading = false,
  icon,
  type = 'button',
  className,
  children,
  disabled,
  ref,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: string;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn('btn', size === 'sm' && 'btn-sm', BUTTON_VARIANTS[variant], className)}
      {...rest}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={size === 'sm' ? 13 : 14} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  tooltip,
  size = 'sm',
  tone = 'default',
  type = 'button',
  className,
  children,
  ref,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  icon?: string;
  label: string;
  tooltip?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  tone?: 'default' | 'danger';
  ref?: Ref<HTMLButtonElement>;
}) {
  const iconSize = size === 'xs' ? 12 : size === 'sm' ? 13 : size === 'lg' ? 17 : 15;
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cn('icon-btn group', `icon-btn-${size}`, tone === 'danger' && 'icon-btn-danger', className)}
      {...rest}
    >
      {children ?? <Icon name={icon ?? 'chevronDown'} size={iconSize} />}
      <Tooltip label={tooltip ?? label} />
    </button>
  );
}

export function Tooltip({
  label,
  side = 'bottom',
  className,
}: {
  label: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties | null>(null);

  // Tooltip dipasang di body lewat portal supaya tidak terpotong overflow
  // parent, lalu dijepit ke dalam viewport setiap kali muncul.
  useEffect(() => {
    const host = anchorRef.current?.parentElement;
    if (!host) return;
    const show = () => setOpen(true);
    const hide = () => setOpen(false);
    host.addEventListener('pointerenter', show);
    host.addEventListener('pointerleave', hide);
    host.addEventListener('focusin', show);
    host.addEventListener('focusout', hide);
    return () => {
      host.removeEventListener('pointerenter', show);
      host.removeEventListener('pointerleave', hide);
      host.removeEventListener('focusin', show);
      host.removeEventListener('focusout', hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const host = anchorRef.current?.parentElement;
      const tip = tipRef.current;
      if (!host || !tip) return;
      const anchor = host.getBoundingClientRect();
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const gap = 6;
      const margin = 8;
      const left =
        side === 'left'
          ? anchor.left - width - gap
          : side === 'right'
            ? anchor.right + gap
            : anchor.left + anchor.width / 2 - width / 2;
      const top =
        side === 'top'
          ? anchor.top - height - gap
          : side === 'bottom'
            ? anchor.bottom + gap
            : anchor.top + anchor.height / 2 - height / 2;
      setPos({
        left: Math.min(Math.max(margin, left), Math.max(margin, vw - width - margin)),
        top: Math.min(Math.max(margin, top), Math.max(margin, vh - height - margin)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, side]);

  return (
    <>
      <span ref={anchorRef} aria-hidden="true" className="hidden" />
      {open && typeof document !== 'undefined'
        ? createPortal(
            <span ref={tipRef} aria-hidden="true" style={pos ?? undefined} className={cn('tooltip', className)}>
              {label}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

export function Input({
  invalid,
  className,
  ref,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn('input', invalid && 'border-bad/60', className)}
      {...rest}
    />
  );
}

export function Textarea({
  invalid,
  className,
  ref,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn('input resize-y leading-relaxed', invalid && 'border-bad/60', className)}
      {...rest}
    />
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="field-label">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {error ? (
        <p id={id ? id + '-error' : undefined} className="field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={id ? id + '-hint' : undefined} className="field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Checkbox({
  label,
  className,
  ref,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; ref?: Ref<HTMLInputElement> }) {
  const autoId = useId();
  const inputId = rest.id ?? autoId;
  return (
    <label htmlFor={inputId} className={cn('inline-flex cursor-pointer items-center gap-2 text-[13px] text-ink', className)}>
      <input ref={ref} id={inputId} type="checkbox" className="checkbox" {...rest} />
      {label ? <span className="min-w-0 select-none">{label}</span> : null}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  icon,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  icon?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex w-full cursor-pointer items-center justify-between gap-3 rounded-control border px-3 py-2 text-left transition-colors duration-[var(--duration-fast)]',
        checked ? 'border-accent/40 bg-accent/5' : 'border-line bg-panel2/30',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon ? <Icon name={icon} size={14} className="shrink-0 text-accent/80" /> : null}
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-ink">{label}</span>
          {description ? <span className="mt-0.5 block text-[12px] leading-snug text-muted">{description}</span> : null}
        </span>
      </span>
      <span className="switch" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
    </button>
  );
}

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

/**
 * Select kustom: trigger + popover listbox, tanpa <select> native.
 * Fokus tetap di trigger; opsi aktif ditandai aria-activedescendant.
 */
export function Select<T extends string = string>({
  value,
  onChange,
  options,
  id,
  label,
  placeholder,
  disabled,
  size = 'md',
  className,
  triggerClassName,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SelectOption<T>>;
  id?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  triggerClassName?: string;
}) {
  const autoId = useId();
  const listId = autoId + '-listbox';
  const triggerId = id ?? autoId + '-trigger';
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const current = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const optionId = (index: number) => listId + '-opt-' + index;

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const choose = (option: SelectOption<T>) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveActive = (delta: number) => {
    const count = options.length;
    if (!count) return;
    let index = active;
    for (let step = 0; step < count; step += 1) {
      index = (index + delta + count) % count;
      if (!options[index]?.disabled) {
        setActive(index);
        return;
      }
    }
  };

  const openList = () => {
    if (disabled) return;
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openList();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      const first = options.findIndex((option) => !option.disabled);
      if (first >= 0) setActive(first);
    } else if (event.key === 'End') {
      event.preventDefault();
      for (let index = options.length - 1; index >= 0; index -= 1) {
        if (!options[index]?.disabled) {
          setActive(index);
          break;
        }
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = options[active];
      if (option) choose(option);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={cn(
          'input flex cursor-pointer items-center gap-2 pr-8 text-left',
          size === 'sm' && 'min-h-8 py-1 text-[12.5px]',
          triggerClassName,
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !current && 'text-muted/60')}>
          {current ? current.label : (placeholder ?? '')}
        </span>
        <Icon
          name="chevronDown"
          size={12}
          className={cn('shrink-0 text-muted transition-transform duration-[var(--duration-fast)]', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          className="popover absolute top-full z-50 mt-1 max-h-64 w-full overflow-y-auto outline-none"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === active;
            return (
              <div
                key={option.value + ':' + index}
                id={optionId(index)}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                data-active={isActive}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
                className={cn(
                  'menu-item',
                  isActive && 'bg-panel2 text-ink',
                  option.disabled && 'pointer-events-none opacity-40',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {isSelected ? <Icon name="check" size={13} className="shrink-0 text-accent" /> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export type MenuEntry =
  | {
      id: string;
      type?: 'item';
      label: ReactNode;
      icon?: string;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { id: string; type: 'separator' }
  | { id: string; type: 'label'; label: string };

export function DropdownMenu({
  entries,
  label,
  triggerIcon,
  triggerLabel,
  triggerAriaLabel,
  triggerTitle,
  triggerDisabled = false,
  triggerRef,
  triggerSize = 'md',
  align = 'end',
  menuId,
  className,
  menuClassName,
  triggerClassName,
}: {
  entries: MenuEntry[];
  label: string;
  triggerIcon?: string;
  triggerLabel?: string;
  triggerAriaLabel?: string;
  triggerTitle?: string;
  triggerDisabled?: boolean;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  triggerSize?: 'sm' | 'md' | 'lg';
  align?: 'start' | 'end';
  menuId?: string;
  className?: string;
  menuClassName?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const autoId = useId();
  const id = menuId ?? autoId;
  const localRef = useRef<HTMLButtonElement>(null);
  const ref = triggerRef ?? localRef;
  const menuRef = useRef<HTMLDivElement>(null);
  const { onTriggerKeyDown } = useMenu(open, setOpen, ref, menuRef);

  const triggerProps = {
    'aria-haspopup': 'menu' as const,
    'aria-controls': open ? id : undefined,
    'aria-expanded': open,
    onClick: () => setOpen((previous) => !previous),
    onKeyDown: onTriggerKeyDown,
    disabled: triggerDisabled,
  };

  return (
    <div className={cn('relative', className)}>
      {triggerLabel ? (
        <Button
          ref={ref}
          size={triggerSize === 'lg' ? 'md' : triggerSize}
          icon={triggerIcon}
          title={triggerTitle}
          className={triggerClassName}
          {...triggerProps}
        >
          {triggerLabel}
        </Button>
      ) : (
        <IconButton
          ref={ref}
          icon={triggerIcon}
          label={triggerAriaLabel ?? label}
          tooltip={triggerTitle}
          size={triggerSize}
          className={triggerClassName}
          {...triggerProps}
        />
      )}
      {open ? (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={label}
          className={cn(
            'popover absolute top-full z-50 mt-1 max-h-80 w-60 overflow-y-auto',
            align === 'end' ? 'right-0' : 'left-0',
            menuClassName,
          )}
        >
          {entries.map((entry) => {
            if (entry.type === 'separator') {
              return <div key={entry.id} role="separator" className="menu-sep" />;
            }
            if (entry.type === 'label') {
              return (
                <div key={entry.id} className="menu-label">
                  {entry.label}
                </div>
              );
            }
            return (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                className={cn('menu-item', entry.danger && 'menu-item-danger')}
                onClick={() => {
                  entry.onSelect();
                  setOpen(false);
                  ref.current?.focus();
                }}
              >
                {entry.icon ? <Icon name={entry.icon} size={14} className="shrink-0 text-muted" /> : null}
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.shortcut ? <span className="menu-shortcut">{entry.shortcut}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const DIALOG_SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
} as const;

export function Dialog({
  open,
  onClose,
  children,
  labelledBy,
  describedBy,
  role = 'dialog',
  size = 'md',
  initialFocusRef,
  closeOnBackdrop = true,
  className,
  backdropClassName,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
  describedBy?: string;
  role?: 'dialog' | 'alertdialog';
  size?: keyof typeof DIALOG_SIZES;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnBackdrop?: boolean;
  className?: string;
  backdropClassName?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef, initialFocusRef);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={cn('dialog-backdrop', backdropClassName)}
      role="presentation"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={cn('dialog-panel', DIALOG_SIZES[size], className)}
      >
        {children}
      </div>
    </div>
  );
}

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
  itemClassName,
}: {
  items: ReadonlyArray<{ id: T; label: ReactNode; icon?: string }>;
  value: T;
  onChange: (value: T) => void;
  label?: string;
  className?: string;
  itemClassName?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = items.findIndex((item) => item.id === value);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (index + delta + items.length) % items.length;
    const next = items[nextIndex];
    if (!next) return;
    onChange(next.id);
    refs.current[nextIndex]?.focus();
  };

  return (
    <div role="group" aria-label={label} className={cn('seg', className)} onKeyDown={onKeyDown}>
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="button"
          aria-pressed={item.id === value}
          onClick={() => onChange(item.id)}
          className={cn('seg-item', itemClassName)}
        >
          {item.icon ? <Icon name={item.icon} size={13} /> : null}
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function Toolbar({
  label,
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="toolbar" aria-label={label} className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {children}
    </div>
  );
}

const BADGE_TONES = {
  neutral: '',
  accent: 'border-accent/35 bg-accent/10 text-accent',
  ok: 'border-ok/35 bg-ok/10 text-ok',
  warn: 'border-warn/35 bg-warn/10 text-warn',
  bad: 'border-bad/35 bg-bad/10 text-bad',
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={cn('badge', BADGE_TONES[tone], className)}>{children}</span>;
}

export function Pill({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn('badge rounded-pill px-2.5 py-1 text-[11px]', BADGE_TONES[tone], className)}>
      {children}
    </span>
  );
}

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card', className)} {...rest}>
      {children}
    </div>
  );
}

export function Panel({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('soft-panel', className)} {...rest}>
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('skeleton', className)} />;
}