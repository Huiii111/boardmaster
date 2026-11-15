/**
 * Server-side environment validation.
 *
 * This module must never be imported from a client component: it reads secrets.
 * `src/lib/tutor/mode.ts` exposes the safe, non-secret summary for the client.
 */

import 'server-only';

export interface ServerEnv {
  anthropicApiKey: string | null;
  tutorModel: string;
  /** Absolute path or command name for an ngspice binary, when configured. */
  ngspicePath: string | null;
  maxTutorTokens: number;
  /** ElevenLabs text-to-speech. Optional: browser speech is the fallback. */
  elevenLabsApiKey: string | null;
  elevenLabsVoiceId: string;
  elevenLabsModel: string;
}

export interface EnvValidation {
  env: ServerEnv;
  warnings: string[];
}

const DEFAULT_MODEL = 'claude-sonnet-5-5';
const DEFAULT_MAX_TOKENS = 1400;

let cached: EnvValidation | null = null;

export function readServerEnv(): EnvValidation {
  if (cached) return cached;

  const warnings: string[] = [];

  const rawKey = process.env.ANTHROPIC_API_KEY?.trim();
  let anthropicApiKey: string | null = null;
  if (!rawKey) {
    warnings.push(
      'ANTHROPIC_API_KEY is not set. The AI Tutor will run in Local Demo Tutor mode (deterministic, rule-based explanations).',
    );
  } else if (!rawKey.startsWith('sk-')) {
    warnings.push(
      'ANTHROPIC_API_KEY does not look like an Anthropic key (expected an "sk-" prefix). Falling back to Local Demo Tutor mode.',
    );
  } else {
    anthropicApiKey = rawKey;
  }

  // The old CIRCUITMENTOR_* names are still accepted so an existing .env keeps
  // working after the rename; the BOARDMASTER_* names take precedence.
  const tutorModel =
    process.env.BOARDMASTER_TUTOR_MODEL?.trim() ||
    process.env.CIRCUITMENTOR_TUTOR_MODEL?.trim() ||
    DEFAULT_MODEL;

  const ngspiceRaw = process.env.NGSPICE_PATH?.trim();
  const ngspicePath = ngspiceRaw && ngspiceRaw.length > 0 ? ngspiceRaw : null;

  const tokensRaw =
    process.env.BOARDMASTER_MAX_TOKENS?.trim() || process.env.CIRCUITMENTOR_MAX_TOKENS?.trim();
  let maxTutorTokens = DEFAULT_MAX_TOKENS;
  if (tokensRaw) {
    const parsed = Number(tokensRaw);
    if (Number.isInteger(parsed) && parsed >= 256 && parsed <= 8192) {
      maxTutorTokens = parsed;
    } else {
      warnings.push(
        `BOARDMASTER_MAX_TOKENS="${tokensRaw}" is not an integer in 256..8192; using ${DEFAULT_MAX_TOKENS}.`,
      );
    }
  }

  const rawEleven = process.env.ELEVENLABS_API_KEY?.trim();
  const elevenLabsApiKey = rawEleven && rawEleven.length > 0 ? rawEleven : null;
  // "Rachel" — a clear, neutral default from the public ElevenLabs voice list.
  const elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || '21m00Tcm4TlvDq8ikWAM';
  const elevenLabsModel = process.env.ELEVENLABS_MODEL?.trim() || 'eleven_turbo_v2_5';

  cached = {
    env: {
      anthropicApiKey,
      tutorModel,
      ngspicePath,
      maxTutorTokens,
      elevenLabsApiKey,
      elevenLabsVoiceId,
      elevenLabsModel,
    },
    warnings,
  };
  return cached;
}

/** True when a usable Anthropic key is configured. */
export function hasClaudeKey(): boolean {
  return readServerEnv().env.anthropicApiKey !== null;
}
