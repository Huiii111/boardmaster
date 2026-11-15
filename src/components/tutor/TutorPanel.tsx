'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Eraser, GraduationCap, Lightbulb, Send, ShieldCheck, Square, User, Volume2 } from 'lucide-react';

import { HINT_LEVELS, type HintLevel } from '@/lib/tutor/types';
import { Badge, Button, Panel, cx } from '@/components/ui/primitives';
import { useLabStore } from '@/store/useLabStore';
import { browserSpeechAvailable, speech } from '@/lib/voice/speech';

/**
 * Minimal, dependency-free markdown renderer for tutor replies.
 *
 * Supports exactly what the tutor is told to emit: bold, inline code, blockquotes,
 * ordered/unordered lists, italics and paragraphs. Everything is escaped first,
 * so model output can never inject markup.
 */
function renderMarkdown(src: string): string {
  const escape = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const inline = (s: string): string =>
    escape(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])_([^_]+)_(?=[\s.,)!?]|$)/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,)!?]|$)/g, '$1<em>$2</em>');

  const lines = src.split('\n');
  const out: string[] = [];
  let listType: 'ol' | 'ul' | null = null;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      out.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = (): void => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim().length === 0) {
      flushParagraph();
      closeList();
      continue;
    }

    const ordered = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (ordered) {
      flushParagraph();
      if (listType !== 'ol') {
        closeList();
        out.push('<ol>');
        listType = 'ol';
      }
      out.push(`<li>${inline(ordered[2] ?? '')}</li>`);
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      if (listType !== 'ul') {
        closeList();
        out.push('<ul>');
        listType = 'ul';
      }
      out.push(`<li>${inline(bullet[1] ?? '')}</li>`);
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      closeList();
      out.push(`<blockquote>${inline(quote[1] ?? '')}</blockquote>`);
      continue;
    }

    closeList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  closeList();

  return out.join('');
}

const QUICK_PROMPTS = [
  'Why is my LED not lighting up?',
  'Is my resistor value appropriate?',
  'Check my LED polarity.',
  'Walk me through the current calculation.',
];

export function TutorPanel() {
  const messages = useLabStore((s) => s.tutorMessages);
  const busy = useLabStore((s) => s.tutorBusy);
  const hintLevel = useLabStore((s) => s.hintLevel);
  const setHintLevel = useLabStore((s) => s.setHintLevel);
  const askTutor = useLabStore((s) => s.askTutor);
  const clearTutor = useLabStore((s) => s.clearTutor);
  const server = useLabStore((s) => s.server);
  const report = useLabStore((s) => s.report);
  const autoSpeak = useLabStore((s) => s.autoSpeak);
  const setAutoSpeak = useLabStore((s) => s.setAutoSpeak);
  const speakingMessageId = useLabStore((s) => s.speakingMessageId);
  const setSpeakingMessageId = useLabStore((s) => s.setSpeakingMessageId);

  const [draft, setDraft] = useState('');
  const [canSpeak, setCanSpeak] = useState(false);
  const spokenRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, busy]);

  // Voice availability + keep the store in step with what is actually playing.
  useEffect(() => {
    setCanSpeak(browserSpeechAvailable());
    void speech.loadVoices();
    const unsubscribe = speech.subscribe((id) => setSpeakingMessageId(id));
    return () => {
      unsubscribe();
      speech.stop();
    };
  }, [setSpeakingMessageId]);

  const useEleven = server.speech?.elevenlabs ?? false;

  const speakMessage = useCallback(
    (id: string, content: string) => {
      if (speech.currentId === id) {
        speech.stop();
        return;
      }
      void speech.speak(id, content, useEleven);
    },
    [useEleven],
  );

  // Read each newly arrived tutor reply once, when auto-speak is on.
  useEffect(() => {
    if (!autoSpeak || busy) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'tutor' || last.error) return;
    if (spokenRef.current === last.id) return;
    spokenRef.current = last.id;
    void speech.speak(last.id, last.content, useEleven);
  }, [messages, autoSpeak, busy, useEleven]);

  const mode = server.tutor?.mode ?? 'local-demo';

  const submit = (): void => {
    const q = draft.trim();
    if (q.length === 0 || busy) return;
    setDraft('');
    void askTutor(q, hintLevel);
  };

  const rendered = useMemo(
    () => messages.map((m) => ({ ...m, html: m.role === 'tutor' ? renderMarkdown(m.content) : null })),
    [messages],
  );

  return (
    <Panel
      title="AI Teaching Assistant"
      icon={<GraduationCap size={12} aria-hidden />}
      flush
      actions={
        <>
          <Badge tone={mode === 'claude' ? 'accent' : 'warn'}>
            {mode === 'claude' ? (server.tutor?.model ?? 'Claude') : 'Local demo'}
          </Badge>
          {canSpeak ? (
            <Button
              size="icon"
              variant="ghost"
              active={autoSpeak}
              onClick={() => {
                const next = !autoSpeak;
                setAutoSpeak(next);
                if (!next) speech.stop();
              }}
              title={
                autoSpeak
                  ? `Auto-read is on (${server.speech?.label ?? 'browser speech'}). Click to turn off.`
                  : `Read each reply aloud (${server.speech?.label ?? 'browser speech'})`
              }
              aria-label="Toggle reading replies aloud"
            >
              <Volume2 size={12} aria-hidden />
            </Button>
          ) : null}
          {messages.length > 0 ? (
            <Button size="icon" variant="ghost" onClick={clearTutor} title="Clear conversation">
              <Eraser size={12} aria-hidden />
            </Button>
          ) : null}
        </>
      }
    >
      {/* hint level selector */}
      <div className="border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Lightbulb size={11} className="text-[var(--signal-warn)]" aria-hidden />
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            Hint level
          </span>
        </div>
        <div
          className="grid grid-cols-3 gap-1"
          role="radiogroup"
          aria-label="How much help the tutor should give"
        >
          {HINT_LEVELS.map((lv) => (
            <button
              key={lv.level}
              type="button"
              role="radio"
              aria-checked={hintLevel === lv.level}
              onClick={() => setHintLevel(lv.level as HintLevel)}
              title={lv.blurb}
              className={cx(
                'rounded-md border px-1.5 py-1.5 text-left transition-all duration-150',
                hintLevel === lv.level
                  ? 'border-[var(--accent-cyan)] bg-[rgba(11,122,109,0.1)]'
                  : 'border-[var(--border-default)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]',
              )}
            >
              <div
                className={cx(
                  'text-[10px] font-semibold',
                  hintLevel === lv.level ? 'text-[var(--accent-cyan)]' : 'text-[var(--text-secondary)]',
                )}
              >
                {lv.level}. {lv.name}
              </div>
            </button>
          ))}
        </div>
        <p className="mt-1.5 note">
          {HINT_LEVELS.find((l) => l.level === hintLevel)?.blurb}
        </p>
      </div>

      {/* conversation */}
      <div
        ref={scrollRef}
        className="max-h-[340px] min-h-[150px] overflow-y-auto px-3 py-2.5 scroll-lab"
        aria-live="polite"
        aria-busy={busy}
      >
        {rendered.length === 0 ? (
          <div className="space-y-2.5 py-1">
            <div className="flex items-start gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-2.5">
              <Bot size={14} className="mt-0.5 shrink-0 text-[var(--accent-cyan)]" aria-hidden />
              <div className="min-w-0">
                <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                  I can see your circuit graph, the netlist and the analyser&apos;s findings — but only after
                  you run the simulation. I will not change your design or invent readings; I quote the
                  evidence and help you work it out.
                </p>
              </div>
            </div>

            {!report ? (
              <p className="px-0.5 note">
                Tip: press <strong className="text-[var(--text-tertiary)]">Run Simulation</strong> first so I
                have measurements to talk about.
              </p>
            ) : null}

            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                Try asking
              </div>
              <div className="space-y-1">
                {QUICK_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void askTutor(p, hintLevel)}
                    className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 py-1.5 text-left text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {rendered.map((m) => (
              <li key={m.id} className="animate-fade-up">
                {m.role === 'student' ? (
                  <div className="flex items-start justify-end gap-2">
                    <div className="max-w-[86%] rounded-lg rounded-br-sm border border-[rgba(13,111,209,0.3)] bg-[rgba(13,111,209,0.1)] px-2.5 py-1.5">
                      <p className="text-[11px] leading-relaxed text-[var(--text-primary)]">{m.content}</p>
                    </div>
                    <span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--surface-active)] text-[var(--text-tertiary)]">
                      <User size={11} aria-hidden />
                    </span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <span
                      className={cx(
                        'mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full',
                        m.error
                          ? 'bg-[rgba(202,43,43,0.15)] text-[var(--signal-error)]'
                          : 'bg-[rgba(11,122,109,0.14)] text-[var(--accent-cyan)]',
                      )}
                    >
                      <Bot size={11} aria-hidden />
                    </span>
                    <div
                      className={cx(
                        'min-w-0 max-w-[90%] rounded-lg rounded-bl-sm border px-2.5 py-2',
                        m.error
                          ? 'border-[rgba(202,43,43,0.3)] bg-[rgba(202,43,43,0.07)]'
                          : 'border-[var(--border-subtle)] bg-[var(--surface-raised)]',
                      )}
                    >
                      <div
                        className="tutor-prose"
                        // Source is escaped inside renderMarkdown before any tag is added.
                        dangerouslySetInnerHTML={{ __html: m.html ?? '' }}
                      />
                      <div className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-[var(--border-subtle)] pt-1.5">
                        {m.hintLevel ? (
                          <Badge tone="neutral">
                            Level {m.hintLevel}
                          </Badge>
                        ) : null}
                        {m.source ? (
                          <Badge tone={m.source === 'claude' ? 'accent' : 'warn'}>
                            {m.source === 'claude' ? 'Claude' : 'Local demo tutor'}
                          </Badge>
                        ) : null}
                        {m.groundedIn && m.groundedIn.length > 0 ? (
                          <Badge
                            tone="info"
                            title={`Grounded in deterministic diagnostics: ${m.groundedIn.join(', ')}`}
                          >
                            <ShieldCheck size={9} aria-hidden />
                            {m.groundedIn.length} evidence code
                            {m.groundedIn.length === 1 ? '' : 's'}
                          </Badge>
                        ) : null}
                        {canSpeak && !m.error ? (
                          <button
                            type="button"
                            onClick={() => speakMessage(m.id, m.content)}
                            title={
                              speakingMessageId === m.id
                                ? 'Stop reading'
                                : `Read this explanation aloud (${server.speech?.label ?? 'browser speech'})`
                            }
                            aria-label={
                              speakingMessageId === m.id ? 'Stop reading' : 'Read this explanation aloud'
                            }
                            className={cx(
                              'ml-auto inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] transition-colors',
                              speakingMessageId === m.id
                                ? 'border-[rgba(11,122,109,0.4)] bg-[rgba(11,122,109,0.12)] text-[var(--accent-cyan)]'
                                : 'border-[var(--border-default)] text-[var(--text-disabled)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]',
                            )}
                          >
                            {speakingMessageId === m.id ? (
                              <>
                                <Square size={8} aria-hidden />
                                Stop
                              </>
                            ) : (
                              <>
                                <Volume2 size={9} aria-hidden />
                                Listen
                              </>
                            )}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}
              </li>
            ))}
            {busy ? (
              <li className="flex items-center gap-2 pl-7">
                <span className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)] animate-lab-pulse"
                      style={{ animationDelay: `${i * 160}ms` }}
                    />
                  ))}
                </span>
                <span className="text-[10px] text-[var(--text-disabled)]">Reading your evidence…</span>
              </li>
            ) : null}
          </ul>
        )}
      </div>

      {/* composer */}
      <div className="border-t border-[var(--border-subtle)] p-2.5">
        <div className="flex gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder="Ask about your circuit…  (Enter to send, Shift+Enter for a new line)"
            aria-label="Question for the AI tutor"
            disabled={busy}
            className="min-h-[46px] flex-1 resize-none rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-disabled)] transition-colors hover:border-[var(--border-strong)] focus:border-[var(--accent-cyan)] focus:outline-none disabled:opacity-50"
          />
          <Button
            variant="accent"
            size="icon"
            className="h-[46px] w-9"
            onClick={submit}
            disabled={draft.trim().length === 0}
            loading={busy}
            title="Send (Enter)"
            aria-label="Send question"
          >
            {!busy ? <Send size={14} aria-hidden /> : null}
          </Button>
        </div>
        <p className="mt-1.5 text-[9px] leading-snug text-[var(--text-disabled)]">
          The tutor receives your circuit graph, netlist, measurements and diagnostics — and is instructed to
          cite only those. It cannot edit your design.
          {canSpeak ? ` Spoken replies use ${server.speech?.label ?? 'your browser’s built-in speech'}.` : ''}
        </p>
      </div>
    </Panel>
  );
}
