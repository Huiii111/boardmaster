import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

import { readServerEnv } from '@/lib/env';
import { localTutorReply } from '@/lib/tutor/localTutor';
import { TUTOR_SYSTEM_PROMPT, buildTutorUserMessage, groundingCodes } from '@/lib/tutor/prompt';
import type { HintLevel, TutorRequestBody, TutorResponseBody } from '@/lib/tutor/types';

export const runtime = 'nodejs';
/** The tutor depends on live request data only; never cache a reply. */
export const dynamic = 'force-dynamic';

const MAX_QUESTION_CHARS = 2000;
const MAX_HISTORY_TURNS = 8;

function isHintLevel(v: unknown): v is HintLevel {
  return v === 1 || v === 2 || v === 3;
}

/** Validate the request body without trusting anything from the client. */
function parseBody(raw: unknown): { body: TutorRequestBody } | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'Request body must be a JSON object.' };
  const obj = raw as Record<string, unknown>;

  if (typeof obj.question !== 'string') return { error: '`question` must be a string.' };
  if (obj.question.length > MAX_QUESTION_CHARS) {
    return { error: `\`question\` must be at most ${MAX_QUESTION_CHARS} characters.` };
  }
  if (!isHintLevel(obj.hintLevel)) return { error: '`hintLevel` must be 1, 2 or 3.' };
  if (typeof obj.evidence !== 'object' || obj.evidence === null) {
    return { error: '`evidence` must be the structured evidence object.' };
  }

  const history = Array.isArray(obj.history) ? obj.history : [];
  const cleanHistory = history
    .filter(
      (h): h is { role: 'student' | 'tutor'; content: string } =>
        typeof h === 'object' &&
        h !== null &&
        ((h as { role?: unknown }).role === 'student' || (h as { role?: unknown }).role === 'tutor') &&
        typeof (h as { content?: unknown }).content === 'string',
    )
    .slice(-MAX_HISTORY_TURNS);

  return {
    body: {
      question: obj.question,
      hintLevel: obj.hintLevel,
      evidence: obj.evidence as TutorRequestBody['evidence'],
      history: cleanHistory,
    },
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON in request body.' }, { status: 400 });
  }

  const parsed = parseBody(raw);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { question, hintLevel, evidence, history } = parsed.body;

  const { env } = readServerEnv();
  const grounded = groundingCodes(evidence);

  /* -------- Local Demo Tutor: no key configured -------- */
  if (!env.anthropicApiKey) {
    const local = localTutorReply({ question, hintLevel, evidence });
    const body: TutorResponseBody = {
      reply: local.reply,
      source: 'local-demo',
      fallbackReason:
        'ANTHROPIC_API_KEY is not configured on the server, so the deterministic Local Demo Tutor answered instead of Claude.',
      groundedIn: local.groundedIn.length > 0 ? local.groundedIn : grounded,
    };
    return NextResponse.json(body);
  }

  /* -------- Claude -------- */
  try {
    const client = new Anthropic({ apiKey: env.anthropicApiKey });

    const messages: Anthropic.MessageParam[] = [
      ...history.map((h) => ({
        role: (h.role === 'student' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user', content: buildTutorUserMessage({ question, hintLevel, evidence }) },
    ];

    const response = await client.messages.create({
      model: env.tutorModel,
      max_tokens: env.maxTutorTokens,
      system: TUTOR_SYSTEM_PROMPT,
      messages,
    });

    const reply = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (reply.length === 0) {
      throw new Error('Claude returned no text content.');
    }

    const body: TutorResponseBody = {
      reply,
      source: 'claude',
      model: response.model,
      groundedIn: grounded,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
    return NextResponse.json(body);
  } catch (error) {
    // Never fail the lesson because the API is unavailable: fall back, and say so.
    const message = error instanceof Error ? error.message : String(error);
    const local = localTutorReply({ question, hintLevel, evidence, reason: 'api-failed' });
    const body: TutorResponseBody = {
      reply: local.reply,
      source: 'local-demo',
      fallbackReason: `The Claude API call failed (${message}). The deterministic Local Demo Tutor answered instead.`,
      groundedIn: local.groundedIn.length > 0 ? local.groundedIn : grounded,
    };
    return NextResponse.json(body, { status: 200 });
  }
}
