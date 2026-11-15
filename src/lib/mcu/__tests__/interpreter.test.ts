import { describe, expect, it } from 'vitest';

import { runSketch } from '../interpreter';
import { parseSketch } from '../parser';
import { tokenize } from '../lexer';

/**
 * The interpreter must genuinely execute the student's code. These tests pin
 * real execution: control flow, arithmetic, pin order, timing, and the exact
 * errors a student gets when their sketch is wrong.
 */

const BLINK = `
void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`;

describe('lexer', () => {
  it('tracks line and column for every token', () => {
    const tokens = tokenize('int a;\n  int b;');
    const b = tokens.find((t) => t.value === 'b');
    expect(b?.line).toBe(2);
    expect(b?.column).toBe(7);
  });

  it('skips comments and preprocessor lines', () => {
    const tokens = tokenize('#include <Servo.h>\n// hi\n/* block */ int a;');
    expect(tokens.map((t) => t.value).filter(Boolean)).toEqual(['int', 'a', ';']);
  });

  it('reads hex and binary literals', () => {
    const p = parseSketch('void setup(){int a = 0xFF; int b = 0b1010;} void loop(){}');
    expect(p.functions[0]?.body).toHaveLength(2);
  });
});

describe('blink', () => {
  const r = runSketch(BLINK, 'arduino_uno', { loopIterations: 3 });

  it('runs without errors', () => {
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.loopsRun).toBe(3);
  });

  it('drives D13 high and low in program order', () => {
    const d13 = r.events.filter((e) => e.pin === 'd13' && e.mode === 'output');
    const values = d13.map((e) => e.value);
    // setup sets OUTPUT (0), then HIGH, LOW, HIGH, LOW, HIGH, LOW
    expect(values.slice(-6)).toEqual([1, 0, 1, 0, 1, 0]);
  });

  it('advances virtual time by the delays, not wall time', () => {
    expect(r.elapsedMs).toBe(3000); // 3 loops x (500 + 500)
  });

  it('timestamps each transition', () => {
    const highs = r.events.filter((e) => e.pin === 'd13' && e.value === 1);
    expect(highs.map((e) => e.t)).toEqual([0, 1000, 2000]);
  });

  it('leaves D13 low at the end', () => {
    expect(r.pinValues.d13).toBe(0);
    expect(r.pinModes.d13).toBe('output');
  });
});

describe('syntax errors point at the mistake', () => {
  it('reports a missing semicolon with its line', () => {
    const r = runSketch('void setup(){ int a = 1 }\nvoid loop(){}', 'arduino_uno');
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.stage).toBe('parse');
    expect(r.errors[0]?.message).toContain("Expected ';'");
    expect(r.errors[0]?.line).toBe(1);
  });

  it('reports an unclosed brace', () => {
    const r = runSketch('void setup(){\n  int a = 1;\nvoid loop(){}', 'arduino_uno');
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.stage).toBe('parse');
  });

  it('reports an unterminated string with a hint', () => {
    const r = runSketch('void setup(){ Serial.begin(9600); Serial.println("oops); }\nvoid loop(){}', 'arduino_uno');
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.message).toContain('Unterminated string');
  });

  it('requires both setup and loop', () => {
    const r = runSketch('void setup(){}', 'arduino_uno');
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.message).toContain('missing loop()');
    expect(r.errors[0]?.hint).toContain('void loop()');
  });
});

describe('runtime errors are real', () => {
  it('catches a pin that does not exist on the board', () => {
    const r = runSketch(
      'void setup(){ pinMode(99, OUTPUT); }\nvoid loop(){}',
      'arduino_uno',
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.stage).toBe('runtime');
    expect(r.errors[0]?.message).toContain('pin 99 does not exist');
    expect(r.errors[0]?.line).toBe(1);
  });

  it('catches digitalWrite to a pin that was never set OUTPUT', () => {
    const r = runSketch('void setup(){}\nvoid loop(){ digitalWrite(13, HIGH); }', 'arduino_uno');
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.message).toContain('not an OUTPUT');
    expect(r.errors[0]?.hint).toContain('pinMode(13, OUTPUT)');
    expect(r.errors[0]?.line).toBe(2);
  });

  it('catches analogWrite to a non-PWM pin', () => {
    const r = runSketch(
      'void setup(){ pinMode(7, OUTPUT); }\nvoid loop(){ analogWrite(7, 128); }',
      'arduino_uno',
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.message).toContain('no PWM');
    expect(r.errors[0]?.hint).toContain('3');
  });

  it('catches an undeclared variable', () => {
    const r = runSketch('void setup(){}\nvoid loop(){ x = 5; }', 'arduino_uno');
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.message).toContain("'x' is not declared");
  });

  it('catches an unknown function', () => {
    const r = runSketch('void setup(){ digitalWirte(13, HIGH); }\nvoid loop(){}', 'arduino_uno');
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.message).toContain('digitalWirte');
  });

  it('catches division by zero', () => {
    const r = runSketch('void setup(){ int a = 1/0; }\nvoid loop(){}', 'arduino_uno');
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.message).toContain('Division by zero');
  });

  it('catches an out-of-bounds array index', () => {
    const r = runSketch(
      'int xs[3] = {1,2,3};\nvoid setup(){ int a = xs[5]; }\nvoid loop(){}',
      'arduino_uno',
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.message).toContain('out of bounds');
  });

  it('catches Serial.print before Serial.begin', () => {
    const r = runSketch('void setup(){ Serial.println("hi"); }\nvoid loop(){}', 'arduino_uno');
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.hint).toContain('Serial.begin');
  });

  it('stops an infinite loop instead of hanging', () => {
    const r = runSketch('void setup(){ while(1) { } }\nvoid loop(){}', 'arduino_uno', {
      stepBudget: 5000,
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.stage).toBe('limit');
    expect(r.errors[0]?.message).toContain('step budget');
    expect(r.steps).toBeLessThan(6000);
  });
});

describe('language features execute correctly', () => {
  const run = (body: string) =>
    runSketch(`int out = 0;\nvoid setup(){ Serial.begin(9600); ${body} }\nvoid loop(){}`, 'arduino_uno');

  it('does integer division like C', () => {
    const r = run('Serial.println(7 / 2);');
    expect(r.serial[0]?.text.trim()).toBe('3');
  });

  it('respects operator precedence', () => {
    const r = run('Serial.println(2 + 3 * 4);');
    expect(r.serial[0]?.text.trim()).toBe('14');
  });

  it('runs for loops with accumulation', () => {
    const r = run('int s = 0; for (int i = 1; i <= 5; i++) { s += i; } Serial.println(s);');
    expect(r.serial[0]?.text.trim()).toBe('15');
  });

  it('honours break and continue', () => {
    const r = run(
      'int s = 0; for (int i = 0; i < 10; i++) { if (i == 3) continue; if (i == 6) break; s += i; } Serial.println(s);',
    );
    // 0+1+2+4+5 = 12
    expect(r.serial[0]?.text.trim()).toBe('12');
  });

  it('calls user-defined functions', () => {
    const r = runSketch(
      'int twice(int n) { return n * 2; }\nvoid setup(){ Serial.begin(9600); Serial.println(twice(21)); }\nvoid loop(){}',
      'arduino_uno',
    );
    expect(r.serial[0]?.text.trim()).toBe('42');
  });

  it('short-circuits && and ||', () => {
    const r = run('int a = 0; if (a != 0 && 10 / a > 1) { } Serial.println("safe");');
    expect(r.ok).toBe(true);
    expect(r.serial[0]?.text.trim()).toBe('safe');
  });

  it('supports arrays and indexing', () => {
    const r = runSketch(
      'int xs[4] = {5, 10, 15, 20};\nvoid setup(){ Serial.begin(9600); xs[0] = 1; Serial.println(xs[0] + xs[3]); }\nvoid loop(){}',
      'arduino_uno',
    );
    expect(r.serial[0]?.text.trim()).toBe('21');
  });

  it('implements map() like Arduino', () => {
    const r = run('Serial.println(map(512, 0, 1023, 0, 255));');
    expect(r.serial[0]?.text.trim()).toBe('127');
  });

  it('tracks millis() against the virtual clock', () => {
    const r = runSketch(
      'void setup(){ Serial.begin(9600); delay(250); Serial.println(millis()); }\nvoid loop(){}',
      'arduino_uno',
    );
    expect(r.serial[0]?.text.trim()).toBe('250');
  });

  it('keeps globals alive across loop iterations', () => {
    const r = runSketch(
      'int count = 0;\nvoid setup(){ Serial.begin(9600); }\nvoid loop(){ count++; Serial.println(count); }',
      'arduino_uno',
      { loopIterations: 3 },
    );
    expect(r.serial.map((l) => l.text.trim())).toEqual(['1', '2', '3']);
  });

  it('is deterministic: the same sketch gives the same result', () => {
    const a = runSketch(BLINK, 'arduino_uno', { loopIterations: 3 });
    const b = runSketch(BLINK, 'arduino_uno', { loopIterations: 3 });
    expect(a.events).toEqual(b.events);
    expect(a.elapsedMs).toBe(b.elapsedMs);
  });
});

describe('pins read the circuit', () => {
  it('digitalRead reflects the voltage on the pin net', () => {
    const sketch =
      'void setup(){ Serial.begin(9600); pinMode(2, INPUT); pinMode(13, OUTPUT); }\n' +
      'void loop(){ if (digitalRead(2) == HIGH) { digitalWrite(13, HIGH); } else { digitalWrite(13, LOW); } }';

    const pressed = runSketch(sketch, 'arduino_uno', {
      loopIterations: 1,
      readPinVolts: (pin) => (pin === 'd2' ? 5 : null),
    });
    expect(pressed.pinValues.d13).toBe(1);

    const released = runSketch(sketch, 'arduino_uno', {
      loopIterations: 1,
      readPinVolts: (pin) => (pin === 'd2' ? 0 : null),
    });
    expect(released.pinValues.d13).toBe(0);
  });

  it('analogRead scales the pin voltage to the ADC range', () => {
    const r = runSketch(
      'void setup(){ Serial.begin(9600); Serial.println(analogRead(A0)); }\nvoid loop(){}',
      'arduino_uno',
      { readPinVolts: (pin) => (pin === 'a0' ? 2.5 : null) },
    );
    // 2.5 V of 5 V on a 10-bit ADC
    expect(Number(r.serial[0]?.text.trim())).toBe(512);
  });

  it('a floating INPUT_PULLUP reads HIGH', () => {
    const r = runSketch(
      'void setup(){ Serial.begin(9600); pinMode(2, INPUT_PULLUP); Serial.println(digitalRead(2)); }\nvoid loop(){}',
      'arduino_uno',
    );
    expect(r.serial[0]?.text.trim()).toBe('1');
  });

  it('records PWM duty from analogWrite', () => {
    const r = runSketch(
      'void setup(){ pinMode(9, OUTPUT); analogWrite(9, 64); }\nvoid loop(){}',
      'arduino_uno',
    );
    expect(r.pinValues.d9).toBeCloseTo(64 / 255, 6);
  });
});

describe('ESP32 differences are real', () => {
  it('rejects a pin the ESP32 does not have', () => {
    const r = runSketch('void setup(){ pinMode(13, OUTPUT); }\nvoid loop(){}', 'esp32');
    expect(r.ok).toBe(true); // 13 exists on the ESP32
    const bad = runSketch('void setup(){ pinMode(7, OUTPUT); }\nvoid loop(){}', 'esp32');
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]?.message).toContain('ESP32');
  });

  it('uses a 12-bit ADC and 3.3 V logic', () => {
    const r = runSketch(
      'void setup(){ Serial.begin(9600); Serial.println(analogRead(32)); }\nvoid loop(){}',
      'esp32',
      { readPinVolts: () => 3.3 },
    );
    expect(Number(r.serial[0]?.text.trim())).toBe(4095);
  });
});
