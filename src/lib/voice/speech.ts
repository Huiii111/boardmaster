/**
 * Spoken tutor explanations.
 *
 * Two engines, same graceful-degradation pattern as the tutor itself:
 *
 *  - **Browser speech** (`speechSynthesis`) — always available, offline, no key,
 *    no cost. This is the default so the lab is demonstrable anywhere.
 *  - **ElevenLabs** — used only when the server reports a key is configured.
 *    Higher quality; falls back to browser speech on any failure.
 *
 * Nothing here is required for the lesson: voice is an accessibility and demo
 * aid layered on top of text that is always present.
 */

export type VoiceEngine = 'browser' | 'elevenlabs' | 'unavailable';

export interface SpeechCapabilities {
  browser: boolean;
  elevenlabs: boolean;
}

/**
 * Strip the markdown the tutor emits so it is not read aloud character by
 * character ("star star Local Demo Tutor star star").
 *
 * Also expands the engineering notation a screen reader would otherwise
 * mangle, so "9.09 mA" is spoken as "9.09 milliamps".
 */
export function toSpeakableText(markdown: string): string {
  let text = markdown;

  // Fenced and inline code.
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/`([^`]+)`/g, '$1');

  // Emphasis and headings.
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1$2');
  text = text.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1$2');
  text = text.replace(/^#{1,6}\s+/gm, '');

  // Blockquotes and list markers become sentence breaks.
  text = text.replace(/^\s*>\s?/gm, '');
  text = text.replace(/^\s*[-*]\s+/gm, '. ');
  text = text.replace(/^\s*(\d+)\.\s+/gm, '. Step $1. ');

  // Links: keep the label, drop the target.
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // Units and symbols, spoken the way a demonstrator would say them.
  const UNITS: Array<[RegExp, string]> = [
    [/(\d)\s*mΩ/g, '$1 milliohms'],
    [/(\d)\s*kΩ/g, '$1 kilohms'],
    [/(\d)\s*MΩ/g, '$1 megohms'],
    [/(\d)\s*Ω/g, '$1 ohms'],
    [/(\d)\s*µA/g, '$1 microamps'],
    [/(\d)\s*mA/g, '$1 milliamps'],
    [/(\d)\s*A\b/g, '$1 amps'],
    [/(\d)\s*mV/g, '$1 millivolts'],
    [/(\d)\s*kV/g, '$1 kilovolts'],
    [/(\d)\s*V\b/g, '$1 volts'],
    [/(\d)\s*mW/g, '$1 milliwatts'],
    [/(\d)\s*W\b/g, '$1 watts'],
    [/(\d)\s*µF/g, '$1 microfarads'],
    [/(\d)\s*nF/g, '$1 nanofarads'],
    [/(\d)\s*pF/g, '$1 picofarads'],
    [/(\d)\s*mm\b/g, '$1 millimetres'],
    [/(\d)\s*°/g, '$1 degrees'],
  ];
  for (const [pattern, replacement] of UNITS) text = text.replace(pattern, replacement);

  text = text.replace(/V_f/g, 'V F').replace(/V_supply/g, 'supply voltage');
  text = text.replace(/→/g, ' to ').replace(/−/g, ' minus ').replace(/×/g, ' times ');
  text = text.replace(/\bR\b/g, 'R').replace(/≈/g, ' approximately ');

  // Collapse whitespace and tidy the sentence breaks the list rules introduced.
  text = text.replace(/\s*\.\s*\./g, '.');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{2,}/g, '. ');
  text = text.replace(/\n/g, ' ');
  text = text.replace(/\s+([.,;:!?])/g, '$1');
  text = text.replace(/\.{2,}/g, '.');

  return text.trim();
}

/** True when this browser can speak at all. */
export function browserSpeechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Pick the most natural-sounding English voice available locally.
 * Browsers expose wildly different lists, so this is best-effort and
 * deterministic for a given list.
 */
export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const pool = english.length > 0 ? english : voices;

  const PREFERRED = ['natural', 'neural', 'google uk english', 'google us english', 'samantha', 'daniel'];
  for (const want of PREFERRED) {
    const hit = pool.find((v) => v.name.toLowerCase().includes(want));
    if (hit) return hit;
  }
  const localFirst = pool.find((v) => v.localService);
  return localFirst ?? pool[0] ?? null;
}

/* --------------------------------------------------------------------------
 * Speech controller
 * -------------------------------------------------------------------------- */

type StateListener = (speakingId: string | null) => void;

class SpeechController {
  private listeners = new Set<StateListener>();
  private speakingId: string | null = null;
  private audio: HTMLAudioElement | null = null;
  private voices: SpeechSynthesisVoice[] = [];

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l(this.speakingId);
  }

  private setSpeaking(id: string | null): void {
    this.speakingId = id;
    this.emit();
  }

  get currentId(): string | null {
    return this.speakingId;
  }

  /** Voice lists load asynchronously in most browsers. */
  async loadVoices(): Promise<SpeechSynthesisVoice[]> {
    if (!browserSpeechAvailable()) return [];
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      this.voices = existing;
      return existing;
    }
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        this.voices = window.speechSynthesis.getVoices();
        resolve(this.voices);
      }, 1200);
      window.speechSynthesis.addEventListener(
        'voiceschanged',
        () => {
          window.clearTimeout(timeout);
          this.voices = window.speechSynthesis.getVoices();
          resolve(this.voices);
        },
        { once: true },
      );
    });
  }

  stop(): void {
    if (browserSpeechAvailable()) window.speechSynthesis.cancel();
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }
    this.setSpeaking(null);
  }

  /**
   * Speak `markdown`, preferring ElevenLabs when the server has a key.
   * Returns the engine that actually produced the audio.
   */
  async speak(id: string, markdown: string, useElevenLabs: boolean): Promise<VoiceEngine> {
    this.stop();
    const text = toSpeakableText(markdown);
    if (text.length === 0) return 'unavailable';

    if (useElevenLabs) {
      try {
        const engine = await this.speakViaElevenLabs(id, text);
        if (engine === 'elevenlabs') return engine;
      } catch {
        // Fall through to browser speech rather than failing silently.
      }
    }
    return this.speakViaBrowser(id, text);
  }

  private async speakViaElevenLabs(id: string, text: string): Promise<VoiceEngine> {
    const response = await fetch('/api/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) return 'unavailable';
    const type = response.headers.get('Content-Type') ?? '';
    if (!type.startsWith('audio/')) return 'unavailable';

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.audio = audio;
    this.setSpeaking(id);

    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      void audio.play().catch(() => resolve());
    });

    URL.revokeObjectURL(url);
    if (this.audio === audio) {
      this.audio = null;
      this.setSpeaking(null);
    }
    return 'elevenlabs';
  }

  private speakViaBrowser(id: string, text: string): VoiceEngine {
    if (!browserSpeechAvailable()) return 'unavailable';

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(this.voices.length > 0 ? this.voices : window.speechSynthesis.getVoices());
    if (voice) utterance.voice = voice;
    // Slightly slower than default: these are explanations, not notifications.
    utterance.rate = 0.98;
    utterance.pitch = 1;
    utterance.lang = voice?.lang ?? 'en-GB';

    utterance.onstart = () => this.setSpeaking(id);
    utterance.onend = () => {
      if (this.speakingId === id) this.setSpeaking(null);
    };
    utterance.onerror = () => {
      if (this.speakingId === id) this.setSpeaking(null);
    };

    window.speechSynthesis.speak(utterance);
    this.setSpeaking(id);
    return 'browser';
  }
}

export const speech = new SpeechController();
