/** AST for the supported Arduino C++ subset. */

export interface Pos {
  line: number;
  column: number;
}

export type Expr =
  | ({ kind: 'number'; value: number } & Pos)
  | ({ kind: 'string'; value: string } & Pos)
  | ({ kind: 'ident'; name: string } & Pos)
  | ({ kind: 'unary'; op: string; operand: Expr } & Pos)
  | ({ kind: 'binary'; op: string; left: Expr; right: Expr } & Pos)
  | ({ kind: 'logical'; op: '&&' | '||'; left: Expr; right: Expr } & Pos)
  | ({ kind: 'assign'; op: string; target: Expr; value: Expr } & Pos)
  | ({ kind: 'update'; op: '++' | '--'; target: Expr; prefix: boolean } & Pos)
  | ({ kind: 'call'; callee: string; args: Expr[] } & Pos)
  | ({ kind: 'member'; object: string; property: string; args: Expr[] } & Pos)
  | ({ kind: 'index'; target: Expr; index: Expr } & Pos)
  | ({ kind: 'ternary'; test: Expr; then: Expr; otherwise: Expr } & Pos);

export type Stmt =
  | ({ kind: 'var'; declaredType: string; name: string; init: Expr | null; arraySize: Expr | null } & Pos)
  | ({ kind: 'expr'; expr: Expr } & Pos)
  | ({ kind: 'block'; body: Stmt[] } & Pos)
  | ({ kind: 'if'; test: Expr; then: Stmt; otherwise: Stmt | null } & Pos)
  | ({ kind: 'while'; test: Expr; body: Stmt } & Pos)
  | ({ kind: 'doWhile'; test: Expr; body: Stmt } & Pos)
  | ({ kind: 'for'; init: Stmt | null; test: Expr | null; update: Expr | null; body: Stmt } & Pos)
  | ({ kind: 'return'; value: Expr | null } & Pos)
  | ({ kind: 'break' } & Pos)
  | ({ kind: 'continue' } & Pos);

export interface FunctionDecl extends Pos {
  name: string;
  returnType: string;
  params: Array<{ name: string; declaredType: string }>;
  body: Stmt[];
}

export interface Program {
  globals: Stmt[];
  functions: FunctionDecl[];
}
