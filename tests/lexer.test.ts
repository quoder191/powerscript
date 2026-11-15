import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { TokenType } from '../src/compiler/lexer/tokens.ts';

export interface TestCaseResult {
  suite: string;
  name: string;
  passed: boolean;
  error?: string;
}

function expectEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function runLexerTests(): TestCaseResult[] {
  const tests: Array<{ name: string; fn: () => void }> = [
    {
      name: 'Tokenizes variable declarations and primitive literals',
      fn: () => {
        const res = tokenize('let count: int = 42\nconst ratio: float = 3.14');
        expectEqual(res.diagnostics.length, 0, 'diagnostics');
        const types = res.tokens.map((t) => t.type);
        expectEqual(types[0], TokenType.Let, 'let token');
        expectEqual(types[1], TokenType.Identifier, 'identifier');
        expectEqual(types[2], TokenType.Colon, 'colon');
        expectEqual(types[3], TokenType.Identifier, 'int type');
        expectEqual(types[4], TokenType.Assign, 'assign');
        expectEqual(types[5], TokenType.IntLiteral, 'int literal');
        expectEqual(res.tokens[5].literal, 42, 'int value');
      },
    },
    {
      name: 'Tokenizes pointer keywords and operators',
      fn: () => {
        const res = tokenize('own box = 10\nref view = &box\n*box = 20\ndrop box');
        expectEqual(res.diagnostics.length, 0, 'diagnostics');
        const types = res.tokens.filter((t) => t.type !== TokenType.Newline && t.type !== TokenType.EOF).map((t) => t.type);
        expectEqual(types[0], TokenType.Own, 'own');
        expectEqual(types[4], TokenType.Ref, 'ref');
        expectEqual(types[7], TokenType.Ampersand, 'ampersand');
        expectEqual(types[9], TokenType.Star, 'deref star');
        expectEqual(types[13], TokenType.Drop, 'drop');
      },
    },
    {
      name: 'Distinguishes range operator from float decimals',
      fn: () => {
        const res = tokenize('for i in 0..=10 { }');
        expectEqual(res.diagnostics.length, 0, 'diagnostics');
        const types = res.tokens.map((t) => t.type);
        expectEqual(types.includes(TokenType.RangeInclusive), true, 'range inclusive');
        const nums = res.tokens.filter((t) => t.type === TokenType.IntLiteral);
        expectEqual(nums.length, 2, 'two integer endpoints');
      },
    },
    {
      name: 'Tokenizes pipelines, arrows, hex, binary, and f-strings',
      fn: () => {
        const res = tokenize('let mask = 0xFF\nlet bits = 0b1010\nlet msg = f"val={mask}"\ndata |> map(fn(x) => x + 1)');
        expectEqual(res.diagnostics.length, 0, 'diagnostics');
        expectEqual(res.tokens.some((t) => t.type === TokenType.FStringLiteral), true, 'f-string');
        expectEqual(res.tokens.some((t) => t.type === TokenType.PipeArrow), true, 'pipeline');
        expectEqual(res.tokens.some((t) => t.type === TokenType.FatArrow), true, 'fat arrow');
        const ints = res.tokens.filter((t) => t.type === TokenType.IntLiteral);
        expectEqual(ints[0].literal, 255, 'hex value');
        expectEqual(ints[1].literal, 10, 'binary value');
      },
    },
    {
      name: 'Reports error on unterminated string literal',
      fn: () => {
        const res = tokenize('let s = "unterminated');
        expectEqual(res.diagnostics.length > 0, true, 'has error');
      },
    },
    {
      name: 'Tokenizes var, function alias, ++, and -- operators',
      fn: () => {
        const res = tokenize('var i = 0\ni++\n--i\nfunction greet() {}');
        expectEqual(res.diagnostics.length, 0, 'diagnostics');
        const types = res.tokens.map((t) => t.type);
        expectEqual(types.includes(TokenType.Var), true, 'var token');
        expectEqual(types.includes(TokenType.PlusPlus), true, '++ token');
        expectEqual(types.includes(TokenType.MinusMinus), true, '-- token');
        expectEqual(types.includes(TokenType.Fn), true, 'function -> Fn token');
      },
    },
  ];

  return tests.map((t) => {
    try {
      t.fn();
      return { suite: 'Lexer', name: t.name, passed: true };
    } catch (err) {
      return {
        suite: 'Lexer',
        name: t.name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
