/**
 * Lexer for the supported Arduino C++ subset.
 *
 * Positions are tracked on every token so that a syntax error can point at the
 * exact line and column in the student's sketch, the way a real compiler does.
 */

export type TokenType = 'number' | 'string' | 'char' | 'ident' | 'keyword' | 'op' | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

/** A diagnostic from any stage of the pipeline. */
export interface SketchError {
  stage: 'parse' | 'runtime' | 'limit';
  message: string;
  line: number;
  column: number;
  /** Short hint on how to fix it, when there is an obvious one. */
  hint?: string;
}

export class SketchSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'SketchSyntaxError';
  }
}

export const KEYWORDS = new Set([
  'void', 'int', 'long', 'float', 'double', 'bool', 'boolean', 'byte', 'char',
  'unsigned', 'signed', 'short', 'const', 'static', 'String',
  'if', 'else', 'while', 'for', 'do', 'return', 'break', 'continue', 'switch', 'case', 'default',
  'true', 'false',
]);

/** Multi-character operators, longest first so greedy matching works. */
const OPERATORS = [
  '<<=', '>>=', '==', '!=', '<=', '>=', '&&', '||', '++', '--',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '::',
  '+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '^', '~',
  '(', ')', '{', '}', '[', ']', ';', ',', '.', '?', ':',
];

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;

  const col = (): number => i - lineStart + 1;
  const push = (type: TokenType, value: string, startCol: number): void => {
    tokens.push({ type, value, line, column: startCol });
  };

  while (i < source.length) {
    const c = source[i] as string;

    // newlines
    if (c === '\n') {
      i += 1;
      line += 1;
      lineStart = i;
      continue;
    }
    // whitespace
    if (c === ' ' || c === '\t' || c === '\r') {
      i += 1;
      continue;
    }
    // line comment
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    // block comment
    if (c === '/' && source[i + 1] === '*') {
      const startLine = line;
      const startCol = col();
      i += 2;
      let closed = false;
      while (i < source.length) {
        if (source[i] === '*' && source[i + 1] === '/') {
          i += 2;
          closed = true;
          break;
        }
        if (source[i] === '\n') {
          line += 1;
          i += 1;
          lineStart = i;
        } else {
          i += 1;
        }
      }
      if (!closed) {
        throw new SketchSyntaxError('Unterminated block comment', startLine, startCol, 'Add a closing */');
      }
      continue;
    }
    // preprocessor: accepted and ignored, so #include compiles rather than
    // throwing at a student who copied a real sketch.
    if (c === '#') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    // number
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const startCol = col();
      let text = '';
      if (c === '0' && (source[i + 1] === 'x' || source[i + 1] === 'X')) {
        text = '0x';
        i += 2;
        while (i < source.length && /[0-9a-fA-F]/.test(source[i] as string)) text += source[i++];
      } else if (c === '0' && (source[i + 1] === 'b' || source[i + 1] === 'B')) {
        text = '0b';
        i += 2;
        while (i < source.length && /[01]/.test(source[i] as string)) text += source[i++];
      } else {
        while (i < source.length && /[0-9.]/.test(source[i] as string)) text += source[i++];
      }
      // numeric suffixes: 100UL, 5L, 1.0f
      while (i < source.length && /[uUlLfF]/.test(source[i] as string)) i += 1;
      push('number', text, startCol);
      continue;
    }
    // string
    if (c === '"') {
      const startCol = col();
      i += 1;
      let text = '';
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\') {
          const next = source[i + 1];
          text +=
            next === 'n' ? '\n' : next === 't' ? '\t' : next === '\\' ? '\\' : next === '"' ? '"' : (next ?? '');
          i += 2;
          continue;
        }
        if (source[i] === '\n') {
          throw new SketchSyntaxError('Unterminated string', line, startCol, 'Strings cannot span lines');
        }
        text += source[i++];
      }
      if (i >= source.length) {
        throw new SketchSyntaxError('Unterminated string', line, startCol, 'Add a closing "');
      }
      i += 1;
      push('string', text, startCol);
      continue;
    }
    // char literal
    if (c === "'") {
      const startCol = col();
      i += 1;
      let text = '';
      while (i < source.length && source[i] !== "'") {
        if (source[i] === '\\') {
          const next = source[i + 1];
          text += next === 'n' ? '\n' : next === 't' ? '\t' : next === '0' ? '\0' : (next ?? '');
          i += 2;
          continue;
        }
        text += source[i++];
      }
      if (i >= source.length) {
        throw new SketchSyntaxError('Unterminated character literal', line, startCol, "Add a closing '");
      }
      i += 1;
      push('char', text, startCol);
      continue;
    }
    // identifier or keyword
    if (/[A-Za-z_]/.test(c)) {
      const startCol = col();
      let text = '';
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i] as string)) text += source[i++];
      push(KEYWORDS.has(text) ? 'keyword' : 'ident', text, startCol);
      continue;
    }
    // operator
    const startCol = col();
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (op) {
      i += op.length;
      push('op', op, startCol);
      continue;
    }

    throw new SketchSyntaxError(
      `Unexpected character '${c}'`,
      line,
      startCol,
      'Remove it, or check for a typo',
    );
  }

  tokens.push({ type: 'eof', value: '', line, column: col() });
  return tokens;
}
