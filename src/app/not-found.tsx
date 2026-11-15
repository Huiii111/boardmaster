import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid h-dvh place-items-center lab-grid px-6">
      <div className="instrument max-w-md rounded-xl p-6 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent-cyan)]">
          404 — open circuit
        </p>
        <h1 className="mt-2 text-lg font-semibold text-[var(--text-primary)]">No such bench</h1>
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
          That route does not exist in BoardMaster. The laboratory lives at the root of the app.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex h-9 items-center rounded-md bg-[var(--accent-cyan)] px-4 text-xs font-semibold text-[#04221f] transition-colors hover:bg-[var(--accent-cyan-bright)]"
        >
          Back to the laboratory
        </Link>
      </div>
    </main>
  );
}
