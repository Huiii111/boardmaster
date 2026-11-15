'use client';

import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ------------------------------- Button ------------------------------- */

export type ButtonVariant = 'primary' | 'accent' | 'ghost' | 'outline' | 'danger' | 'subtle';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent-electric)] text-white hover:bg-[var(--accent-electric-bright)] active:translate-y-px shadow-[0_1px_2px_rgba(16,24,31,0.12)]',
  // White on the darkened teal, not the old near-black: the light theme's
  // accent is dark enough that dark-on-accent fails contrast.
  accent:
    'bg-[var(--accent-cyan)] text-white font-semibold hover:bg-[var(--accent-cyan-bright)] active:translate-y-px shadow-[0_1px_2px_rgba(16,24,31,0.12)]',
  outline:
    'bg-[var(--surface-raised)] text-[var(--text-primary)] border border-[var(--border-default)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]',
  ghost: 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]',
  subtle:
    'bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:bg-[var(--surface-active)] hover:text-[var(--text-primary)]',
  danger:
    'bg-[rgba(202,43,43,0.08)] text-[var(--signal-error)] border border-[rgba(202,43,43,0.28)] hover:bg-[rgba(202,43,43,0.14)]',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[11px] gap-1.5',
  md: 'h-8 px-3 text-xs gap-2',
  lg: 'h-10 px-4 text-sm gap-2',
  icon: 'h-8 w-8 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Renders the pressed state for toggle buttons. */
  active?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'outline', size = 'md', loading = false, active = false, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-pressed={active || undefined}
      className={cx(
        'inline-flex shrink-0 select-none items-center whitespace-nowrap rounded-md font-medium tracking-tight',
        'transition-all duration-150 ease-[var(--ease-lab)]',
        'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-inherit',
        VARIANTS[variant],
        SIZES[size],
        active &&
          'ring-1 ring-[var(--accent-cyan)] bg-[var(--surface-active)] text-[var(--text-primary)]',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={13} className="animate-lab-spin shrink-0" aria-hidden /> : null}
      {children}
    </button>
  );
});

/* -------------------------------- Panel -------------------------------- */

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  /** Removes the inner padding, for lists that manage their own. */
  flush?: boolean;
  subtitle?: ReactNode;
}

export function Panel({
  title,
  icon,
  actions,
  subtitle,
  flush = false,
  className,
  children,
  ...rest
}: PanelProps) {
  return (
    // `shrink-0` matters: panels are direct children of the flex-column
    // sidebars, and without it they compress to fit instead of letting the
    // sidebar scroll, which clips panel content (empty states especially).
    <section className={cx('instrument rounded-lg overflow-hidden shrink-0', className)} {...rest}>
      {title !== undefined ? (
        <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 py-2">
          {icon ? <span className="text-[var(--accent-cyan)] shrink-0">{icon}</span> : null}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--text-secondary)]">
              {title}
            </h2>
            {subtitle ? (
              <p className="truncate text-[10px] text-[var(--text-disabled)]">{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </header>
      ) : null}
      <div className={flush ? '' : 'p-3'}>{children}</div>
    </section>
  );
}

/* -------------------------------- Badge -------------------------------- */

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'error' | 'info' | 'accent';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--surface-hover)] text-[var(--text-tertiary)] border-[var(--border-default)]',
  ok: 'bg-[rgba(11,122,82,0.09)] text-[var(--signal-ok)] border-[rgba(11,122,82,0.25)]',
  warn: 'bg-[rgba(150,88,10,0.09)] text-[var(--signal-warn)] border-[rgba(150,88,10,0.25)]',
  error: 'bg-[rgba(202,43,43,0.08)] text-[var(--signal-error)] border-[rgba(202,43,43,0.25)]',
  info: 'bg-[rgba(26,95,204,0.08)] text-[var(--signal-info)] border-[rgba(26,95,204,0.25)]',
  accent: 'bg-[rgba(11,122,109,0.09)] text-[var(--accent-cyan)] border-[rgba(11,122,109,0.26)]',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  mono = false,
  title,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  mono?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-[10px] font-medium leading-none',
        mono && 'font-mono tabular-nums',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------- Input -------------------------------- */

export interface FieldProps {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  error?: string;
}

export function Field({ label, hint, htmlFor, children, error }: FieldProps) {
  return (
    <div className="space-y-1">
      <label
        htmlFor={htmlFor}
        className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[10px] text-[var(--signal-error)]">
          {error}
        </p>
      ) : hint ? (
        <p className="note">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cx(
          'h-8 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5',
          'text-xs text-[var(--text-primary)] placeholder:text-[var(--text-disabled)]',
          'transition-colors duration-150 hover:border-[var(--border-strong)]',
          'focus:border-[var(--accent-cyan)] focus:outline-none focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...rest}
      />
    );
  },
);

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        'h-8 w-full appearance-none rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)]',
        'px-2.5 pr-7 text-xs text-[var(--text-primary)]',
        'bg-[length:14px] bg-[right_8px_center] bg-no-repeat',
        'transition-colors duration-150 hover:border-[var(--border-strong)] focus:border-[var(--accent-cyan)]',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237c8da2' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...rest}
    >
      {children}
    </select>
  );
}

/* ----------------------------- Readout tile ----------------------------- */

export function Readout({
  label,
  value,
  unit,
  tone = 'live',
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'live' | 'idle' | 'error' | 'warn';
  hint?: string;
}) {
  const color =
    tone === 'live'
      ? 'readout-live'
      : tone === 'error'
        ? 'text-[var(--signal-error)]'
        : tone === 'warn'
          ? 'text-[var(--signal-warn)]'
          : 'text-[var(--text-disabled)]';
  return (
    <div className="readout rounded-md px-2.5 py-2" title={hint}>
      <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-disabled)]">
        {label}
      </div>
      <div className={cx('mt-0.5 flex items-baseline gap-1 text-[15px] font-medium', color)}>
        <span className="truncate">{value}</span>
        {unit ? <span className="text-[10px] opacity-70">{unit}</span> : null}
      </div>
    </div>
  );
}

/* ------------------------------ Empty state ------------------------------ */

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-7 text-center">
      {icon ? <div className="text-[var(--border-strong)]">{icon}</div> : null}
      <h3 className="text-xs font-semibold text-[var(--text-secondary)]">{title}</h3>
      <p className="max-w-[34ch] text-[11px] leading-relaxed text-[var(--text-disabled)]">{body}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/* -------------------------------- Spinner -------------------------------- */

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-4 text-[11px] text-[var(--text-tertiary)]">
      <Loader2 size={14} className="animate-lab-spin text-[var(--accent-cyan)]" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

/* ------------------------------ Skeleton bar ------------------------------ */

export function SkeletonBar({ className }: { className?: string }) {
  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-sm bg-[var(--surface-hover)] animate-sweep',
        className ?? 'h-3 w-full',
      )}
      aria-hidden
    />
  );
}

/* ------------------------------- Key hint ------------------------------- */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-xs border border-[var(--border-default)] bg-[var(--surface-inset)] px-1 py-px font-mono text-[9px] text-[var(--text-tertiary)]">
      {children}
    </kbd>
  );
}

/* ------------------------------- Divider ------------------------------- */

export function Divider({ className }: { className?: string }) {
  return <div className={cx('h-px bg-[var(--border-subtle)]', className)} role="separator" />;
}
