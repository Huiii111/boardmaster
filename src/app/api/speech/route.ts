import { NextResponse } from 'next/server';

import { readServerEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CHARS = 2500;

/**
 * Text-to-speech proxy for the AI tutor.
 *
 * Keeps the ElevenLabs key server-side. When no key is configured this returns
 * 204 and the client falls back to the browser's own speech synthesis, so the
 * spoken tutor works with no account at all — the same degradation pattern as
 * the Claude / Local Demo Tutor split.
 */
export async function POST(request: Request): Promise<NextResponse | Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON in request body.' }, { status: 400 });
  }

  const text =
    typeof raw === 'object' && raw !== null && typeof (raw as { text?: unknown }).text === 'string'
      ? (raw as { text: string }).text
      : null;

  if (!text || text.trim().length === 0) {
    return NextResponse.json({ error: '`text` must be a non-empty string.' }, { status: 400 });
  }
  if (text.length > MAX_CHARS) {
    return NextResponse.json(
      { error: `\`text\` must be at most ${MAX_CHARS} characters.` },
      { status: 400 },
    );
  }

  const { env } = readServerEnv();
  if (!env.elevenLabsApiKey) {
    // 204: nothing to play. The client speaks it locally instead.
    return new Response(null, {
      status: 204,
      headers: { 'X-Speech-Engine': 'browser-fallback' },
    });
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(env.elevenLabsVoiceId)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': env.elevenLabsApiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: env.elevenLabsModel,
          voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.1 },
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return NextResponse.json(
        {
          error: `ElevenLabs returned ${response.status}.`,
          detail: detail.slice(0, 300),
          fallback: 'browser',
        },
        { status: 200 },
      );
    }

    const audio = await response.arrayBuffer();
    return new Response(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-Speech-Engine': 'elevenlabs',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Could not reach ElevenLabs: ${error instanceof Error ? error.message : String(error)}`,
        fallback: 'browser',
      },
      { status: 200 },
    );
  }
}
