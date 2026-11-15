import type { Expr, FunctionDecl, Program, Stmt } from './ast';
import { SketchSyntaxError, tokenize, type Token } from './lexer';

/**
 * Recursive-descent parser for the supported Arduino C++ subset.
 *
 * Deliberately a *subset*, documented in `SUPPORTED_SYNTAX`: anything outside
 * it produces a precise syntax error pointing at the line and column, rather
 * than being silently ignored. Classes, pointers, templates and the
 * preprocessor are not supported — `#include` lines are skipped by the lexer so
 * that a sketch copied from a real project still parses.
 */

const TYPE_KEYWORDS = new Set([
  'void', 'int', 'long', 'float', 'double', 'bool', 'boolean', 'byte', 'char',
  'unsigned', 'signed', 'short', 'String',
]);

/** Binary operator precedence, higher binds tighter. */
const PRECEDENCE: Record<string, number> = {
  '||': 1, '&&': 2,
  '|': 3, '^': 4, '&': 5,
  '==': 6, '!=': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7,
  '<<': 8, '>>': 8,
  '+': 9, '-': 9,
  '*': 10, '/': 10, '%': 10,
};

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)] as Token;
  }

  private at(value: string): boolean {
    const t = this.peek();
    return (t.type === 'op' || t.type === 'keyword') && t.value === value;
  }

  private next(): Token {
    const t = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos += 1;
    return t;
  }

  private expect(value: string, context: string): Token {
    if (!this.at(value)) {
      const t = this.peek();
      const found = t.type === 'eof' ? 'end of sketch' : `'${t.value}'`;
      throw new SketchSyntaxError(
        `Expected '${value}' ${context}, found ${found}`,
        t.line,
        t.column,
        value === ';' ? 'Statements in C++ end with a semicolon' : undefined,
      );
    }
    return this.next();
  }

  private pos2(t: Token): { line: number; column: number } {
    return { line: t.line, column: t.column };
  }

  /* ------------------------------- program ------------------------------- */

  parseProgram(): Program {
    const globals: Stmt[] = [];
    const functions: FunctionDecl[] = [];

    while (this.peek().type !== 'eof') {
      const fn = this.tryParseFunction();
      if (fn) {
        functions.push(fn);
        continue;
      }
      globals.push(this.parseStatement());
    }
    return { globals, functions };
  }

  /** A function is `type name(params) {`; anything else is a statement. */
  private tryParseFunction(): FunctionDecl | null {
    const start = this.pos;
    const t = this.peek();
    if (!(t.type === 'keyword' && (TYPE_KEYWORDS.has(t.value) || t.value === 'const'))) return null;

    const returnType = this.parseTypeName();
    const nameTok = this.peek();
    if (nameTok.type !== 'ident' || !(this.peek(1).type === 'op' && this.peek(1).value === '(')) {
      this.pos = start;
      return null;
    }
    this.next();
    this.expect('(', 'after the function name');

    const params: Array<{ name: string; declaredType: string }> = [];
    while (!this.at(')')) {
      const declaredType = this.parseTypeName();
      const p = this.peek();
      if (p.type !== 'ident') {
        throw new SketchSyntaxError('Expected a parameter name', p.line, p.column);
      }
      this.next();
      params.push({ name: p.value, declaredType });
      if (this.at(',')) this.next();
      else break;
    }
    this.expect(')', 'after the parameter list');

    // A prototype (`void foo();`) is accepted and skipped.
    if (this.at(';')) {
      this.next();
      return null;
    }

    this.expect('{', 'to open the function body');
    const body: Stmt[] = [];
    while (!this.at('}')) {
      if (this.peek().type === 'eof') {
        throw new SketchSyntaxError(
          `Unclosed function '${nameTok.value}'`,
          nameTok.line,
          nameTok.column,
          'Add a closing }',
        );
      }
      body.push(this.parseStatement());
    }
    this.expect('}', 'to close the function body');

    return { name: nameTok.value, returnType, params, body, ...this.pos2(nameTok) };
  }

  /** Consume a (possibly multi-word) type name such as `unsigned long`. */
  private parseTypeName(): string {
    const parts: string[] = [];
    while (true) {
      const t = this.peek();
      if (t.type === 'keyword' && (TYPE_KEYWORDS.has(t.value) || t.value === 'const' || t.value === 'static')) {
        parts.push(t.value);
        this.next();
        continue;
      }
      break;
    }
    // pointer / reference markers are tolerated but carry no meaning here
    while (this.at('*') || this.at('&')) this.next();
    if (parts.length === 0) {
      const t = this.peek();
      throw new SketchSyntaxError(`Expected a type, found '${t.value}'`, t.line, t.column);
    }
    return parts.filter((p) => p !== 'const' && p !== 'static').join(' ') || 'int';
  }

  /* ------------------------------ statements ------------------------------ */

  private parseStatement(): Stmt {
    const t = this.peek();

    if (this.at('{')) {
      this.next();
      const body: Stmt[] = [];
      while (!this.at('}')) {
        if (this.peek().type === 'eof') {
          throw new SketchSyntaxError('Unclosed block', t.line, t.column, 'Add a closing }');
        }
        body.push(this.parseStatement());
      }
      this.next();
      return { kind: 'block', body, ...this.pos2(t) };
    }

    if (this.at('if')) return this.parseIf();
    if (this.at('while')) return this.parseWhile();
    if (this.at('do')) return this.parseDoWhile();
    if (this.at('for')) return this.parseFor();

    if (this.at('return')) {
      this.next();
      const value = this.at(';') ? null : this.parseExpression();
      this.expect(';', 'after return');
      return { kind: 'return', value, ...this.pos2(t) };
    }
    if (this.at('break')) {
      this.next();
      this.expect(';', 'after break');
      return { kind: 'break', ...this.pos2(t) };
    }
    if (this.at('continue')) {
      this.next();
      this.expect(';', 'after continue');
      return { kind: 'continue', ...this.pos2(t) };
    }

    // declaration
    if (t.type === 'keyword' && (TYPE_KEYWORDS.has(t.value) || t.value === 'const' || t.value === 'static')) {
      return this.parseVarDecl();
    }

    const expr = this.parseExpression();
    this.expect(';', 'after the expression');
    return { kind: 'expr', expr, ...this.pos2(t) };
  }

  private parseVarDecl(): Stmt {
    const t = this.peek();
    const declaredType = this.parseTypeName();
    const nameTok = this.peek();
    if (nameTok.type !== 'ident') {
      throw new SketchSyntaxError(
        `Expected a variable name after '${declaredType}'`,
        nameTok.line,
        nameTok.column,
      );
    }
    this.next();

    let arraySize: Expr | null = null;
    if (this.at('[')) {
      this.next();
      arraySize = this.at(']') ? null : this.parseExpression();
      this.expect(']', 'to close the array size');
    }

    let init: Expr | null = null;
    if (this.at('=')) {
      this.next();
      init = this.at('{') ? this.parseArrayLiteral() : this.parseExpression();
    }
    this.expect(';', `after the declaration of '${nameTok.value}'`);
    return { kind: 'var', declaredType, name: nameTok.value, init, arraySize, ...this.pos2(t) };
  }

  /** `{1, 2, 3}` is parsed into a synthetic makeArray() call. */
  private parseArrayLiteral(): Expr {
    const t = this.expect('{', 'to open the array initialiser');
    const args: Expr[] = [];
    while (!this.at('}')) {
      args.push(this.parseExpression());
      if (this.at(',')) this.next();
      else break;
    }
    this.expect('}', 'to close the array initialiser');
    return { kind: 'call', callee: '__array', args, ...this.pos2(t) };
  }

  private parseIf(): Stmt {
    const t = this.expect('if', 'to start a conditional');
    this.expect('(', 'after if');
    const test = this.parseExpression();
    this.expect(')', 'after the if condition');
    const then = this.parseStatement();
    let otherwise: Stmt | null = null;
    if (this.at('else')) {
      this.next();
      otherwise = this.parseStatement();
    }
    return { kind: 'if', test, then, otherwise, ...this.pos2(t) };
  }

  private parseWhile(): Stmt {
    const t = this.expect('while', 'to start a loop');
    this.expect('(', 'after while');
    const test = this.parseExpression();
    this.expect(')', 'after the while condition');
    return { kind: 'while', test, body: this.parseStatement(), ...this.pos2(t) };
  }

  private parseDoWhile(): Stmt {
    const t = this.expect('do', 'to start a loop');
    const body = this.parseStatement();
    this.expect('while', 'after the do block');
    this.expect('(', 'after while');
    const test = this.parseExpression();
    this.expect(')', 'after the while condition');
    this.expect(';', 'after do/while');
    return { kind: 'doWhile', test, body, ...this.pos2(t) };
  }

  private parseFor(): Stmt {
    const t = this.expect('for', 'to start a loop');
    this.expect('(', 'after for');

    let init: Stmt | null = null;
    if (!this.at(';')) {
      const head = this.peek();
      if (head.type === 'keyword' && (TYPE_KEYWORDS.has(head.value) || head.value === 'const')) {
        init = this.parseVarDecl(); // consumes its own ';'
      } else {
        const expr = this.parseExpression();
        this.expect(';', 'after the for initialiser');
        init = { kind: 'expr', expr, ...this.pos2(head) };
      }
    } else {
      this.next();
    }

    const test = this.at(';') ? null : this.parseExpression();
    this.expect(';', 'after the for condition');
    const update = this.at(')') ? null : this.parseExpression();
    this.expect(')', 'after the for header');

    return { kind: 'for', init, test, update, body: this.parseStatement(), ...this.pos2(t) };
  }

  /* ------------------------------ expressions ------------------------------ */

  private parseExpression(): Expr {
    return this.parseAssignment();
  }

  private parseAssignment(): Expr {
    const left = this.parseTernary();
    const t = this.peek();
    if (t.type === 'op' && ASSIGN_OPS.has(t.value)) {
      if (left.kind !== 'ident' && left.kind !== 'index') {
        throw new SketchSyntaxError('Cannot assign to this expression', t.line, t.column);
      }
      this.next();
      const value = this.parseAssignment();
      return { kind: 'assign', op: t.value, target: left, value, ...this.pos2(t) };
    }
    return left;
  }

  private parseTernary(): Expr {
    const test = this.parseBinary(0);
    if (this.at('?')) {
      const t = this.next();
      const then = this.parseAssignment();
      this.expect(':', 'in the conditional expression');
      const otherwise = this.parseAssignment();
      return { kind: 'ternary', test, then, otherwise, ...this.pos2(t) };
    }
    return test;
  }

  private parseBinary(minPrec: number): Expr {
    let left = this.parseUnary();
    while (true) {
      const t = this.peek();
      if (t.type !== 'op') break;
      const prec = PRECEDENCE[t.value];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const right = this.parseBinary(prec + 1);
      left =
        t.value === '&&' || t.value === '||'
          ? { kind: 'logical', op: t.value, left, right, ...this.pos2(t) }
          : { kind: 'binary', op: t.value, left, right, ...this.pos2(t) };
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.type === 'op' && (t.value === '!' || t.value === '-' || t.value === '+' || t.value === '~')) {
      this.next();
      return { kind: 'unary', op: t.value, operand: this.parseUnary(), ...this.pos2(t) };
    }
    if (t.type === 'op' && (t.value === '++' || t.value === '--')) {
      this.next();
      const target = this.parseUnary();
      return { kind: 'update', op: t.value, target, prefix: true, ...this.pos2(t) };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    while (true) {
      const t = this.peek();
      if (t.type === 'op' && (t.value === '++' || t.value === '--')) {
        this.next();
        expr = { kind: 'update', op: t.value, target: expr, prefix: false, ...this.pos2(t) };
        continue;
      }
      if (this.at('[')) {
        this.next();
        const index = this.parseExpression();
        this.expect(']', 'to close the index');
        expr = { kind: 'index', target: expr, index, ...this.pos2(t) };
        continue;
      }
      break;
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const t = this.peek();

    if (t.type === 'number') {
      this.next();
      const value = t.value.startsWith('0x')
        ? parseInt(t.value.slice(2), 16)
        : t.value.startsWith('0b')
          ? parseInt(t.value.slice(2), 2)
          : Number(t.value);
      if (!Number.isFinite(value)) {
        throw new SketchSyntaxError(`Invalid number '${t.value}'`, t.line, t.column);
      }
      return { kind: 'number', value, ...this.pos2(t) };
    }

    if (t.type === 'string') {
      this.next();
      return { kind: 'string', value: t.value, ...this.pos2(t) };
    }

    if (t.type === 'char') {
      this.next();
      return { kind: 'number', value: t.value.charCodeAt(0) || 0, ...this.pos2(t) };
    }

    if (t.type === 'keyword' && (t.value === 'true' || t.value === 'false')) {
      this.next();
      return { kind: 'number', value: t.value === 'true' ? 1 : 0, ...this.pos2(t) };
    }

    if (this.at('(')) {
      this.next();
      const inner = this.parseExpression();
      this.expect(')', 'to close the group');
      return inner;
    }

    if (t.type === 'ident') {
      this.next();
      // Serial.println(...) and friends
      if (this.at('.')) {
        this.next();
        const prop = this.peek();
        if (prop.type !== 'ident') {
          throw new SketchSyntaxError('Expected a method name after .', prop.line, prop.column);
        }
        this.next();
        const args = this.at('(') ? this.parseArgs() : [];
        return { kind: 'member', object: t.value, property: prop.value, args, ...this.pos2(t) };
      }
      if (this.at('(')) {
        return { kind: 'call', callee: t.value, args: this.parseArgs(), ...this.pos2(t) };
      }
      return { kind: 'ident', name: t.value, ...this.pos2(t) };
    }

    const found = t.type === 'eof' ? 'end of sketch' : `'${t.value}'`;
    throw new SketchSyntaxError(`Unexpected ${found}`, t.line, t.column);
  }

  private parseArgs(): Expr[] {
    this.expect('(', 'to open the argument list');
    const args: Expr[] = [];
    while (!this.at(')')) {
      args.push(this.parseExpression());
      if (this.at(',')) this.next();
      else break;
    }
    this.expect(')', 'to close the argument list');
    return args;
  }
}

export function parseSketch(source: string): Program {
  return new Parser(tokenize(source)).parseProgram();
}
