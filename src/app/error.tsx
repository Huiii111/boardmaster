'use client';

import { useEffect } from 'react';

/**
 * Route-level error boundary. The circuit analyser is pure and runs in the
 * browser, so a crash here never corrupts saved work: the design is restored
 * from local storage on reload.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('BoardMaster error boundary:', error);
  }, [error]);

  return (
    <main className="grid h-dvh place-items-center lab-grid px-6">
      <div className="instrument max-w-lg rounded-xl p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--signal-error)]">
          Unexpected fault
        </p>
        <h1 className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
          The laboratory hit an error
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
          Your saved project is kept in this browser&apos;s local storage, so reloading should bring your
          circuit back.
        </p>
        <pre className="mt-3 max-h-32 overflow-auto rounded-md border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-2.5 font-mono text-[10px] leading-snug text-[var(--text-tertiary)]">
          {error.message}
          {error.digest ? `\n\ndigest: ${error.digest}` : ''}
        </pre>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-9 items-center rounded-md bg-[var(--accent-cyan)] px-4 text-xs font-semibold text-[#04221f] transition-colors hover:bg-[var(--accent-cyan-bright)]"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-9 items-center rounded-md border border-[var(--border-default)] px-4 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)]"
          >
            Reload the page
          </button>
        </div>
      </div>
    </main>
  );
}
