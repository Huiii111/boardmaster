import { NextResponse } from 'next/server';

import { readServerEnv } from '@/lib/env';
import { probeNgspice } from '@/lib/sim/ngspice';
import { DETERMINISTIC_DESCRIPTOR } from '@/lib/sim/adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Non-secret capability report for the client.
 *
 * Tells the UI which tutor and which simulation engine are actually available,
 * so every badge on screen reflects reality. No secret value is ever returned —
 * only booleans and human-readable reasons.
 */
export async function GET(): Promise<NextResponse> {
  const { env, warnings } = readServerEnv();
  const ngspice = await probeNgspice();

  return NextResponse.json({
    tutor: {
      mode: env.anthropicApiKey ? ('claude' as const) : ('local-demo' as const),
      model: env.anthropicApiKey ? env.tutorModel : null,
      label: env.anthropicApiKey ? `Claude (${env.tutorModel})` : 'Local Demo Tutor',
    },
    engines: {
      deterministic: DETERMINISTIC_DESCRIPTOR,
      ngspice,
    },
    speech: {
      // Browser speech is decided on the client; the server only reports
      // whether the higher-quality ElevenLabs path is configured.
      elevenlabs: env.elevenLabsApiKey !== null,
      voiceId: env.elevenLabsApiKey ? env.elevenLabsVoiceId : null,
      label: env.elevenLabsApiKey ? 'ElevenLabs' : 'Browser speech',
    },
    warnings,
  });
}
