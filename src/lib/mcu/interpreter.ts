import type { Expr, FunctionDecl, Program, Stmt } from './ast';
import { SketchSyntaxError, type SketchError } from './lexer';
import { parseSketch } from './parser';
import { boardDef, pinByNumber, type BoardDef, type PinMode } from './board';

/**
 * Interpreter for the supported Arduino C++ subset.
 *
 * ## What this is
 * A tree-walking interpreter over the parsed sketch. It is NOT avr-gcc and NOT
 * a cycle-accurate AVR emulator: there is no compilation step, no machine code
 * and no instruction timing. What it does give is real execution — real
 * variables, real control flow, real pin writes in real program order — so the
 * errors a student sees are errors their code actually has.
 *
 * ## Virtual time
 * `delay()` advances a virtual clock instead of blocking, so a sketch that
 * blinks once a second is simulated in microseconds of wall time. `millis()`
 * reads that same clock, so timing logic behaves as written.
 *
 * ## Budgets
 * Execution stops at a step budget and a virtual-time budget. A sketch with an
 * empty `while (true)` is reported as exceeding its budget rather than hanging
 * the browser tab.
 */

export interface PinEvent {
  /** Virtual time in milliseconds. */
  t: number;
  /** Board pin id, e.g. `d13`. */
  pin: string;
  /** 0..1 duty for PWM, or exactly 0 / 1 for digital writes. */
  value: number;
  mode: PinMode;
}

export interface SerialLine {
  t: number;
  text: string;
}

export interface SketchRunOptions {
  /** How many times to call loop(). */
  loopIterations?: number;
  /** Abort after this many interpreter steps. */
  stepBudget?: number;
  /** Abort after this much virtual time, ms. */
  timeBudgetMs?: number;
  /**
   * Reads the voltage currently present on a pin's net, for digitalRead and
   * analogRead. Returns null when the pin is not connected to anything.
   */
  readPinVolts?: (pinId: string) => number | null;
}

export interface SketchRunResult {
  ok: boolean;
  errors: SketchError[];
  /** Final mode of each pin the sketch touched. */
  pinModes: Record<string, PinMode>;
  /** Final value of each pin the sketch drove, 0..1. */
  pinValues: Record<string, number>;
  /** Every pin change, in order — a real digital timing trace. */
  events: PinEvent[];
  serial: SerialLine[];
  /** Virtual milliseconds elapsed. */
  elapsedMs: number;
  steps: number;
  loopsRun: number;
  board: string;
}

/* ------------------------------ control flow ------------------------------ */

class BreakSignal {}
class ContinueSignal {}
class ReturnSignal {
  constructor(readonly value: unknown) {}
}

export class SketchRuntimeError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'SketchRuntimeError';
  }
}

/** A C-style array value. */
class ArrayValue {
  constructor(public items: number[]) {}
}

type Value = number | string | ArrayValue;

class Scope {
  private vars = new Map<string, Value>();

  constructor(private readonly parent: Scope | null = null) {}

  declare(name: string, value: Value): void {
    this.vars.set(name, value);
  }

  has(name: string): boolean {
    return this.vars.has(name) || (this.parent?.has(name) ?? false);
  }

  get(name: string): Value | undefined {
    if (this.vars.has(name)) return this.vars.get(name);
    return this.parent?.get(name);
  }

  set(name: string, value: Value): boolean {
    if (this.vars.has(name)) {
      this.vars.set(name, value);
      return true;
    }
    return this.parent?.set(name, value) ?? false;
  }
}

const CONSTANTS: Record<string, number> = {
  HIGH: 1, LOW: 0,
  INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2,
  LED_BUILTIN: 13,
  A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19,
  PI: Math.PI,
  true: 1, false: 0,
};

export class SketchInterpreter {
  private readonly board: BoardDef;
  private globals = new Scope();
  private functions = new Map<string, FunctionDecl>();

  private steps = 0;
  private clockMs = 0;
  private stepBudget = 400_000;
  private timeBudgetMs = 30_000;

  private pinModes: Record<string, PinMode> = {};
  private pinValues: Record<string, number> = {};
  private events: PinEvent[] = [];
  private serial: SerialLine[] = [];
  private serialOpen = false;
  private readPinVolts: (pinId: string) => number | null = () => null;

  constructor(boardId: Parameters<typeof boardDef>[0]) {
    this.board = boardDef(boardId);
  }

  run(source: string, options: SketchRunOptions = {}): SketchRunResult {
    const errors: SketchError[] = [];
    this.stepBudget = options.stepBudget ?? 400_000;
    this.timeBudgetMs = options.timeBudgetMs ?? 30_000;
    this.readPinVolts = options.readPinVolts ?? (() => null);
    const loopIterations = options.loopIterations ?? 4;

    let program: Program;
    try {
      program = parseSketch(source);
    } catch (error) {
      if (error instanceof SketchSyntaxError) {
        return this.failure([
          { stage: 'parse', message: error.message, line: error.line, column: error.column, hint: error.hint },
        ]);
      }
      throw error;
    }

    for (const fn of program.functions) this.functions.set(fn.name, fn);

    if (!this.functions.has('setup') || !this.functions.has('loop')) {
      const missing = !this.functions.has('setup') ? 'setup' : 'loop';
      return this.failure([
        {
          stage: 'parse',
          message: `Sketch is missing ${missing}()`,
          line: 1,
          column: 1,
          hint: `Every Arduino sketch needs both void setup() and void loop(). Add void ${missing}() { }`,
        },
      ]);
    }

    let loopsRun = 0;
    try {
      for (const g of program.globals) this.execStatement(g, this.globals);
      this.callFunction(this.functions.get('setup') as FunctionDecl, []);
      for (let i = 0; i < loopIterations; i++) {
        this.callFunction(this.functions.get('loop') as FunctionDecl, []);
        loopsRun += 1;
      }
    } catch (error) {
      if (error instanceof SketchRuntimeError) {
        errors.push({
          stage: 'runtime',
          message: error.message,
          line: error.line,
          column: error.column,
          hint: error.hint,
        });
      } else if (error instanceof BudgetExceeded) {
        errors.push({ stage: 'limit', message: error.message, line: error.line, column: error.column, hint: error.hint });
      } else {
        throw error;
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      pinModes: { ...this.pinModes },
      pinValues: { ...this.pinValues },
      events: this.events,
      serial: this.serial,
      elapsedMs: this.clockMs,
      steps: this.steps,
      loopsRun,
      board: this.board.id,
    };
  }

  private failure(errors: SketchError[]): SketchRunResult {
    return {
      ok: false,
      errors,
      pinModes: {},
      pinValues: {},
      events: [],
      serial: [],
      elapsedMs: 0,
      steps: 0,
      loopsRun: 0,
      board: this.board.id,
    };
  }

  /* ------------------------------ execution ------------------------------ */

  private tick(node: { line: number; column: number }): void {
    this.steps += 1;
    if (this.steps > this.stepBudget) {
      throw new BudgetExceeded(
        `Sketch exceeded its step budget of ${this.stepBudget.toLocaleString()} operations`,
        node.line,
        node.column,
        'This usually means a loop never finishes. Check your while/for conditions.',
      );
    }
  }

  private callFunction(fn: FunctionDecl, args: Value[]): Value {
    const scope = new Scope(this.globals);
    fn.params.forEach((p, i) => scope.declare(p.name, args[i] ?? 0));
    try {
      for (const stmt of fn.body) this.execStatement(stmt, scope);
    } catch (signal) {
      if (signal instanceof ReturnSignal) return (signal.value as Value) ?? 0;
      throw signal;
    }
    return 0;
  }

  private execStatement(stmt: Stmt, scope: Scope): void {
    this.tick(stmt);

    switch (stmt.kind) {
      case 'var': {
        if (stmt.arraySize !== null || (stmt.init && stmt.init.kind === 'call' && stmt.init.callee === '__array')) {
          const items =
            stmt.init && stmt.init.kind === 'call' && stmt.init.callee === '__array'
              ? stmt.init.args.map((a) => this.toNumber(this.evaluate(a, scope), a))
              : [];
          const size = stmt.arraySize ? this.toNumber(this.evaluate(stmt.arraySize, scope), stmt.arraySize) : items.length;
          const arr = new Array<number>(Math.max(size, items.length)).fill(0);
          items.forEach((v, i) => (arr[i] = v));
          scope.declare(stmt.name, new ArrayValue(arr));
          return;
        }
        scope.declare(stmt.name, stmt.init ? this.evaluate(stmt.init, scope) : 0);
        return;
      }
      case 'expr':
        this.evaluate(stmt.expr, scope);
        return;
      case 'block': {
        const inner = new Scope(scope);
        for (const s of stmt.body) this.execStatement(s, inner);
        return;
      }
      case 'if':
        if (this.truthy(this.evaluate(stmt.test, scope))) this.execStatement(stmt.then, scope);
        else if (stmt.otherwise) this.execStatement(stmt.otherwise, scope);
        return;
      case 'while':
        while (this.truthy(this.evaluate(stmt.test, scope))) {
          this.tick(stmt);
          try {
            this.execStatement(stmt.body, scope);
          } catch (signal) {
            if (signal instanceof BreakSignal) break;
            if (signal instanceof ContinueSignal) continue;
            throw signal;
          }
        }
        return;
      case 'doWhile':
        do {
          this.tick(stmt);
          try {
            this.execStatement(stmt.body, scope);
          } catch (signal) {
            if (signal instanceof BreakSignal) break;
            if (signal instanceof ContinueSignal) continue;
            throw signal;
          }
        } while (this.truthy(this.evaluate(stmt.test, scope)));
        return;
      case 'for': {
        const inner = new Scope(scope);
        if (stmt.init) this.execStatement(stmt.init, inner);
        while (stmt.test === null || this.truthy(this.evaluate(stmt.test, inner))) {
          this.tick(stmt);
          try {
            this.execStatement(stmt.body, inner);
          } catch (signal) {
            if (signal instanceof BreakSignal) break;
            if (!(signal instanceof ContinueSignal)) throw signal;
          }
          if (stmt.update) this.evaluate(stmt.update, inner);
        }
        return;
      }
      case 'return':
        throw new ReturnSignal(stmt.value ? this.evaluate(stmt.value, scope) : 0);
      case 'break':
        throw new BreakSignal();
      case 'continue':
        throw new ContinueSignal();
      default:
        return;
    }
  }

  /* ------------------------------ expressions ------------------------------ */

  private evaluate(expr: Expr, scope: Scope): Value {
    this.tick(expr);

    switch (expr.kind) {
      case 'number':
        return expr.value;
      case 'string':
        return expr.value;
      case 'ident': {
        if (scope.has(expr.name)) return scope.get(expr.name) as Value;
        const constant = CONSTANTS[expr.name];
        if (constant !== undefined) return constant;
        throw new SketchRuntimeError(
          `'${expr.name}' is not declared`,
          expr.line,
          expr.column,
          'Declare it first, e.g. int ' + expr.name + ' = 0;',
        );
      }
      case 'unary': {
        const v = this.toNumber(this.evaluate(expr.operand, scope), expr);
        if (expr.op === '-') return -v;
        if (expr.op === '+') return v;
        if (expr.op === '!') return v === 0 ? 1 : 0;
        return ~v;
      }
      case 'logical': {
        const left = this.truthy(this.evaluate(expr.left, scope));
        if (expr.op === '&&') return left ? (this.truthy(this.evaluate(expr.right, scope)) ? 1 : 0) : 0;
        return left ? 1 : this.truthy(this.evaluate(expr.right, scope)) ? 1 : 0;
      }
      case 'binary': {
        const l = this.evaluate(expr.left, scope);
        const r = this.evaluate(expr.right, scope);
        if (expr.op === '+' && (typeof l === 'string' || typeof r === 'string')) {
          return `${this.display(l)}${this.display(r)}`;
        }
        const a = this.toNumber(l, expr);
        const b = this.toNumber(r, expr);
        switch (expr.op) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/':
            if (b === 0) {
              throw new SketchRuntimeError('Division by zero', expr.line, expr.column,
                'Guard the divisor, e.g. if (d != 0) { ... }');
            }
            // Integer division, as in C, unless either side is fractional.
            return Number.isInteger(a) && Number.isInteger(b) ? Math.trunc(a / b) : a / b;
          case '%':
            if (b === 0) {
              throw new SketchRuntimeError('Modulo by zero', expr.line, expr.column);
            }
            return a % b;
          case '==': return a === b ? 1 : 0;
          case '!=': return a !== b ? 1 : 0;
          case '<': return a < b ? 1 : 0;
          case '>': return a > b ? 1 : 0;
          case '<=': return a <= b ? 1 : 0;
          case '>=': return a >= b ? 1 : 0;
          case '&': return a & b;
          case '|': return a | b;
          case '^': return a ^ b;
          case '<<': return a << b;
          case '>>': return a >> b;
          default:
            throw new SketchRuntimeError(`Unsupported operator '${expr.op}'`, expr.line, expr.column);
        }
      }
      case 'ternary':
        return this.truthy(this.evaluate(expr.test, scope))
          ? this.evaluate(expr.then, scope)
          : this.evaluate(expr.otherwise, scope);
      case 'assign': {
        const current =
          expr.op === '='
            ? 0
            : this.toNumber(this.evaluate(expr.target, scope), expr);
        const incoming = this.evaluate(expr.value, scope);
        let next: Value;
        if (expr.op === '=') {
          next = incoming;
        } else {
          const b = this.toNumber(incoming, expr);
          switch (expr.op) {
            case '+=': next = current + b; break;
            case '-=': next = current - b; break;
            case '*=': next = current * b; break;
            case '/=':
              if (b === 0) throw new SketchRuntimeError('Division by zero', expr.line, expr.column);
              next = Math.trunc(current / b);
              break;
            case '%=': next = current % b; break;
            case '&=': next = current & b; break;
            case '|=': next = current | b; break;
            case '^=': next = current ^ b; break;
            case '<<=': next = current << b; break;
            case '>>=': next = current >> b; break;
            default: next = b;
          }
        }
        this.assignTo(expr.target, next, scope);
        return next;
      }
      case 'update': {
        const old = this.toNumber(this.evaluate(expr.target, scope), expr);
        const next = expr.op === '++' ? old + 1 : old - 1;
        this.assignTo(expr.target, next, scope);
        return expr.prefix ? next : old;
      }
      case 'index': {
        const target = this.evaluate(expr.target, scope);
        const idx = this.toNumber(this.evaluate(expr.index, scope), expr);
        if (!(target instanceof ArrayValue)) {
          throw new SketchRuntimeError('This value is not an array', expr.line, expr.column);
        }
        if (idx < 0 || idx >= target.items.length) {
          throw new SketchRuntimeError(
            `Array index ${idx} is out of bounds (size ${target.items.length})`,
            expr.line,
            expr.column,
            'C++ does not check this at runtime — on real hardware it would corrupt memory.',
          );
        }
        return target.items[idx] as number;
      }
      case 'member':
        return this.callMember(expr, scope);
      case 'call':
        return this.callNamed(expr, scope);
      default:
        return 0;
    }
  }

  private assignTo(target: Expr, value: Value, scope: Scope): void {
    if (target.kind === 'ident') {
      if (!scope.set(target.name, value)) {
        throw new SketchRuntimeError(
          `'${target.name}' is not declared`,
          target.line,
          target.column,
          `Declare it before assigning, e.g. int ${target.name} = 0;`,
        );
      }
      return;
    }
    if (target.kind === 'index') {
      const arr = this.evaluate(target.target, scope);
      const idx = this.toNumber(this.evaluate(target.index, scope), target);
      if (!(arr instanceof ArrayValue)) {
        throw new SketchRuntimeError('This value is not an array', target.line, target.column);
      }
      if (idx < 0 || idx >= arr.items.length) {
        throw new SketchRuntimeError(
          `Array index ${idx} is out of bounds (size ${arr.items.length})`,
          target.line,
          target.column,
        );
      }
      arr.items[idx] = this.toNumber(value, target);
      return;
    }
    throw new SketchRuntimeError('Cannot assign to this expression', target.line, target.column);
  }

  /* -------------------------------- Arduino API -------------------------------- */

  private resolvePin(n: number, expr: Expr, verb: string) {
    const pin = pinByNumber(this.board, n);
    if (!pin) {
      const available = this.board.pins
        .filter((p) => p.number !== null)
        .map((p) => p.number)
        .join(', ');
      throw new SketchRuntimeError(
        `${verb}: pin ${n} does not exist on the ${this.board.name}`,
        expr.line,
        expr.column,
        `Available pins: ${available}`,
      );
    }
    return pin;
  }

  private recordPin(pinId: string, value: number, mode: PinMode): void {
    if (this.pinValues[pinId] === value && this.pinModes[pinId] === mode) return;
    this.pinValues[pinId] = value;
    this.pinModes[pinId] = mode;
    this.events.push({ t: this.clockMs, pin: pinId, value, mode });
  }

  private callNamed(expr: Expr & { kind: 'call' }, scope: Scope): Value {
    const args = expr.args.map((a) => this.evaluate(a, scope));
    const num = (i: number): number => this.toNumber(args[i] ?? 0, expr);
    const arity = (n: number): void => {
      if (args.length !== n) {
        throw new SketchRuntimeError(
          `${expr.callee}() takes ${n} argument${n === 1 ? '' : 's'}, got ${args.length}`,
          expr.line,
          expr.column,
        );
      }
    };

    switch (expr.callee) {
      case '__array':
        return new ArrayValue(args.map((a) => this.toNumber(a, expr)));

      case 'pinMode': {
        arity(2);
        const pin = this.resolvePin(num(0), expr, 'pinMode');
        const m = num(1);
        const mode: PinMode = m === 1 ? 'output' : m === 2 ? 'input_pullup' : 'input';
        this.recordPin(pin.id, mode === 'input_pullup' ? 1 : (this.pinValues[pin.id] ?? 0), mode);
        return 0;
      }

      case 'digitalWrite': {
        arity(2);
        const pin = this.resolvePin(num(0), expr, 'digitalWrite');
        if (this.pinModes[pin.id] !== 'output') {
          throw new SketchRuntimeError(
            `digitalWrite to pin ${num(0)}, which is not an OUTPUT`,
            expr.line,
            expr.column,
            `Call pinMode(${num(0)}, OUTPUT); in setup() first.`,
          );
        }
        this.recordPin(pin.id, num(1) !== 0 ? 1 : 0, 'output');
        return 0;
      }

      case 'digitalRead': {
        arity(1);
        const pin = this.resolvePin(num(0), expr, 'digitalRead');
        const volts = this.readPinVolts(pin.id);
        if (volts === null) {
          // Floating input. Pull-up resistor decides; otherwise it reads low,
          // and a comment in the UI explains that real floating inputs are noise.
          return this.pinModes[pin.id] === 'input_pullup' ? 1 : 0;
        }
        return volts >= this.board.logicVolts * 0.5 ? 1 : 0;
      }

      case 'analogWrite': {
        arity(2);
        const pin = this.resolvePin(num(0), expr, 'analogWrite');
        if (!pin.pwm) {
          throw new SketchRuntimeError(
            `analogWrite to pin ${num(0)}, which has no PWM`,
            expr.line,
            expr.column,
            `PWM pins on this board: ${this.board.pins.filter((p) => p.pwm).map((p) => p.number).join(', ')}`,
          );
        }
        const duty = Math.min(255, Math.max(0, num(1)));
        this.recordPin(pin.id, duty / 255, 'output');
        return 0;
      }

      case 'analogRead': {
        arity(1);
        const pin = this.resolvePin(num(0), expr, 'analogRead');
        const volts = this.readPinVolts(pin.id);
        if (volts === null) return 0;
        const ratio = Math.min(1, Math.max(0, volts / this.board.logicVolts));
        return Math.round(ratio * this.board.adcMax);
      }

      case 'delay':
        arity(1);
        this.advance(num(0), expr);
        return 0;
      case 'delayMicroseconds':
        arity(1);
        this.advance(num(0) / 1000, expr);
        return 0;
      case 'millis':
        return Math.floor(this.clockMs);
      case 'micros':
        return Math.floor(this.clockMs * 1000);

      case 'map': {
        arity(5);
        const [v, inMin, inMax, outMin, outMax] = [num(0), num(1), num(2), num(3), num(4)];
        if (inMax === inMin) {
          throw new SketchRuntimeError('map() input range is empty', expr.line, expr.column);
        }
        return Math.trunc(((v - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin);
      }
      case 'constrain':
        arity(3);
        return Math.min(Math.max(num(0), num(1)), num(2));
      case 'min':
        return Math.min(num(0), num(1));
      case 'max':
        return Math.max(num(0), num(1));
      case 'abs':
        return Math.abs(num(0));
      case 'sqrt':
        return Math.sqrt(num(0));
      case 'pow':
        return Math.pow(num(0), num(1));
      case 'random':
        // Deterministic: the same sketch must give the same result every run,
        // or the analysis the tutor sees would not be reproducible.
        return args.length >= 2
          ? Math.floor(num(0) + this.pseudoRandom() * (num(1) - num(0)))
          : Math.floor(this.pseudoRandom() * Math.max(1, num(0)));
      case 'randomSeed':
        return 0;

      default: {
        const fn = this.functions.get(expr.callee);
        if (!fn) {
          throw new SketchRuntimeError(
            `'${expr.callee}' is not a function this simulator knows`,
            expr.line,
            expr.column,
            'Check the spelling, or see the supported-API list in the Code panel.',
          );
        }
        if (fn.params.length !== args.length) {
          throw new SketchRuntimeError(
            `${expr.callee}() takes ${fn.params.length} argument(s), got ${args.length}`,
            expr.line,
            expr.column,
          );
        }
        return this.callFunction(fn, args);
      }
    }
  }

  private callMember(expr: Expr & { kind: 'member' }, scope: Scope): Value {
    const args = expr.args.map((a) => this.evaluate(a, scope));

    if (expr.object === 'Serial') {
      switch (expr.property) {
        case 'begin':
          this.serialOpen = true;
          return 0;
        case 'print':
        case 'println': {
          if (!this.serialOpen) {
            throw new SketchRuntimeError(
              'Serial.print before Serial.begin',
              expr.line,
              expr.column,
              'Call Serial.begin(9600); in setup() first.',
            );
          }
          const text = args.map((a) => this.display(a)).join('');
          const last = this.serial[this.serial.length - 1];
          if (expr.property === 'print' && last && !last.text.endsWith('\n')) {
            last.text += text;
          } else {
            this.serial.push({ t: this.clockMs, text });
          }
          if (expr.property === 'println') {
            const line = this.serial[this.serial.length - 1];
            if (line) line.text += '\n';
          }
          return 0;
        }
        case 'available':
          return 0;
        case 'read':
          return -1;
        default:
          throw new SketchRuntimeError(
            `Serial.${expr.property}() is not supported`,
            expr.line,
            expr.column,
            'Supported: begin, print, println, available, read',
          );
      }
    }

    throw new SketchRuntimeError(
      `'${expr.object}' is not an object this simulator knows`,
      expr.line,
      expr.column,
      'Only Serial is available in this subset.',
    );
  }

  private advance(ms: number, node: { line: number; column: number }): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new SketchRuntimeError(`delay(${ms}) is not a valid duration`, node.line, node.column);
    }
    this.clockMs += ms;
    if (this.clockMs > this.timeBudgetMs) {
      throw new BudgetExceeded(
        `Sketch exceeded its ${this.timeBudgetMs} ms simulated-time budget`,
        node.line,
        node.column,
        'Shorten the delays, or run fewer loop iterations.',
      );
    }
  }

  private seed = 0x2545f491;
  private pseudoRandom(): number {
    // xorshift: deterministic across runs so results are reproducible.
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 0xffffffff;
  }

  private truthy(v: Value): boolean {
    if (typeof v === 'string') return v.length > 0;
    if (v instanceof ArrayValue) return v.items.length > 0;
    return v !== 0;
  }

  private toNumber(v: Value, node: { line: number; column: number }): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    throw new SketchRuntimeError('Expected a number, got an array', node.line, node.column);
  }

  private display(v: Value): string {
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
    if (v instanceof ArrayValue) return `[${v.items.join(', ')}]`;
    return v;
  }
}

class BudgetExceeded extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'BudgetExceeded';
  }
}

/** Convenience wrapper. */
export function runSketch(
  source: string,
  boardId: Parameters<typeof boardDef>[0],
  options: SketchRunOptions = {},
): SketchRunResult {
  return new SketchInterpreter(boardId).run(source, options);
}
