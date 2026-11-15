import { describe, expect, it } from 'vitest';

import { pickVoice, toSpeakableText } from '../speech';

describe('markdown to speakable text', () => {
  it('strips bold, italics and inline code', () => {
    const out = toSpeakableText('The **anode** is in `E11` and the _cathode_ in `E09`.');
    expect(out).toBe('The anode is in E11 and the cathode in E09.');
    expect(out).not.toContain('*');
    expect(out).not.toContain('`');
  });

  it('turns numbered steps into spoken steps', () => {
    const out = toSpeakableText('1. Select the LED.\n2. Press R to rotate.');
    expect(out).toContain('Step 1');
    expect(out).toContain('Step 2');
    expect(out).not.toMatch(/^\s*\d+\./);
  });

  it('removes bullet markers', () => {
    const out = toSpeakableText('- first point\n- second point');
    expect(out).not.toContain('- ');
    expect(out).toContain('first point');
    expect(out).toContain('second point');
  });

  it('drops blockquote markers used for the echoed question', () => {
    const out = toSpeakableText('> Why is my LED dark?\n\nBecause it is reversed.');
    expect(out.startsWith('Why is my LED dark?')).toBe(true);
    expect(out).not.toContain('>');
  });

  it('removes fenced code blocks entirely', () => {
    const out = toSpeakableText('Before\n```\nV1 n1 0 DC 5\n```\nAfter');
    expect(out).not.toContain('DC 5');
    expect(out).toContain('Before');
    expect(out).toContain('After');
  });

  it('keeps link text and drops the target', () => {
    const out = toSpeakableText('See [the brief](https://example.com/brief) for details.');
    expect(out).toContain('the brief');
    expect(out).not.toContain('http');
  });
});

describe('spoken units', () => {
  it('expands electrical units a screen reader would mangle', () => {
    expect(toSpeakableText('9.09 mA')).toBe('9.09 milliamps');
    expect(toSpeakableText('330 Ω')).toBe('330 ohms');
    expect(toSpeakableText('4.7 kΩ')).toBe('4.7 kilohms');
    expect(toSpeakableText('5 V')).toBe('5 volts');
    expect(toSpeakableText('45.5 mW')).toBe('45.5 milliwatts');
    expect(toSpeakableText('10 µF')).toBe('10 microfarads');
    expect(toSpeakableText('0.25 mm')).toBe('0.25 millimetres');
  });

  it('reads a whole worked calculation naturally', () => {
    const out = toSpeakableText('I = (5 V − 2.0 V) / 330 Ω = 9.09 mA');
    expect(out).toContain('5 volts');
    expect(out).toContain('2.0 volts');
    expect(out).toContain('330 ohms');
    expect(out).toContain('9.09 milliamps');
    expect(out).toContain('minus');
    expect(out).not.toContain('−');
  });

  it('does not mangle plain words containing unit letters', () => {
    // "A" and "V" only expand when they follow a number.
    const out = toSpeakableText('A Volt is a unit. Anode first.');
    expect(out).toBe('A Volt is a unit. Anode first.');
  });

  it('collapses whitespace and stray punctuation', () => {
    const out = toSpeakableText('Line one\n\n\nLine two   with   gaps');
    expect(out).not.toContain('\n');
    expect(out).not.toMatch(/ {2,}/);
  });

  it('returns an empty string for empty input', () => {
    expect(toSpeakableText('')).toBe('');
    expect(toSpeakableText('   \n  ')).toBe('');
  });

  it('handles a full Local Demo Tutor reply without leaking markup', () => {
    const reply =
      '**Local Demo Tutor** — deterministic rule-based explanations.\n\n' +
      '> Why will my LED not light?\n\n' +
      'Its anode (A) is in hole **E11** and its cathode (K) is in hole **E09** — ' +
      'current arrives at the cathode first, so the measured current is exactly 0 A.';
    const out = toSpeakableText(reply);
    expect(out).not.toContain('**');
    expect(out).not.toContain('>');
    expect(out).toContain('0 amps');
    expect(out).toContain('E11');
  });
});

describe('voice selection', () => {
  const voice = (name: string, lang: string, localService = true): SpeechSynthesisVoice =>
    ({ name, lang, localService, default: false, voiceURI: name }) as SpeechSynthesisVoice;

  it('returns null when the browser exposes no voices', () => {
    expect(pickVoice([])).toBeNull();
  });

  it('prefers a natural or neural English voice', () => {
    const picked = pickVoice([
      voice('Albert', 'en-US'),
      voice('Microsoft Sonia Online (Natural) - English (UK)', 'en-GB'),
    ]);
    expect(picked?.name).toContain('Natural');
  });

  it('prefers English over other languages', () => {
    const picked = pickVoice([voice('Amélie', 'fr-FR'), voice('Daniel', 'en-GB')]);
    expect(picked?.lang.startsWith('en')).toBe(true);
  });

  it('falls back to any voice when none are English', () => {
    const picked = pickVoice([voice('Amélie', 'fr-FR')]);
    expect(picked?.name).toBe('Amélie');
  });

  it('is deterministic for the same list', () => {
    const list = [voice('Albert', 'en-US'), voice('Daniel', 'en-GB')];
    expect(pickVoice(list)?.name).toBe(pickVoice(list)?.name);
  });
});
