export enum TokenType {
  // Literals & Identifiers
  Identifier = 'Identifier',
  IntLiteral = 'IntLiteral',
  FloatLiteral = 'FloatLiteral',
  StringLiteral = 'StringLiteral',
  FStringLiteral = 'FStringLiteral',
  BoolLiteral = 'BoolLiteral',
  NullLiteral = 'NullLiteral',

  // Variable & Function Keywords
  Let = 'Let',
  Var = 'Var',
  Const = 'Const',
  Fn = 'Fn',
  Return = 'Return',

  // OOP & Type System Keywords
  Class = 'Class',
  Struct = 'Struct',
  Enum = 'Enum',
  Trait = 'Trait',
  Implements = 'Implements',
  Extends = 'Extends',
  Init = 'Init',
  Self = 'Self',
  Super = 'Super',
  Pub = 'Pub',
  Priv = 'Priv',
  Prot = 'Prot',
  Static = 'Static',
  Override = 'Override',
  New = 'New',

  // Smart & Rule Pointer Keywords
  Own = 'Own',
  Ref = 'Ref',
  Shared = 'Shared',
  Move = 'Move',
  Borrow = 'Borrow',
  Drop = 'Drop',

  // Control Flow Keywords
  If = 'If',
  Elif = 'Elif',
  Else = 'Else',
  For = 'For',
  In = 'In',
  While = 'While',
  Loop = 'Loop',
  Repeat = 'Repeat',
  Times = 'Times',
  Break = 'Break',
  Continue = 'Continue',
  Match = 'Match',
  Case = 'Case',
  Default = 'Default',
  Try = 'Try',
  Catch = 'Catch',
  Throw = 'Throw',
  Defer = 'Defer',
  Scope = 'Scope',

  // Logical & Type Keywords
  And = 'And',
  Or = 'Or',
  Not = 'Not',
  Is = 'Is',
  As = 'As',

  // Module & UI Keywords
  Import = 'Import',
  Export = 'Export',
  From = 'From',
  Style = 'Style',
  StyleBlock = 'StyleBlock',

  // Operators
  Plus = 'Plus',                 // +
  Minus = 'Minus',               // -
  PlusPlus = 'PlusPlus',         // ++
  MinusMinus = 'MinusMinus',     // --
  Star = 'Star',                 // *
  Slash = 'Slash',               // /
  Percent = 'Percent',           // %
  Power = 'Power',               // **

  Assign = 'Assign',             // =
  PlusAssign = 'PlusAssign',     // +=
  MinusAssign = 'MinusAssign',   // -=
  StarAssign = 'StarAssign',     // *=
  SlashAssign = 'SlashAssign',   // /=

  Equal = 'Equal',               // ==
  NotEqual = 'NotEqual',         // !=
  Less = 'Less',                 // <
  LessEqual = 'LessEqual',       // <=
  Greater = 'Greater',           // >
  GreaterEqual = 'GreaterEqual', // >=

  Bang = 'Bang',                 // !
  Ampersand = 'Ampersand',       // &
  AndAnd = 'AndAnd',             // &&
  Pipe = 'Pipe',                 // |
  PipePipe = 'PipePipe',         // ||
  PipeArrow = 'PipeArrow',       // |>
  Arrow = 'Arrow',               // ->
  FatArrow = 'FatArrow',         // =>
  Range = 'Range',               // ..
  RangeInclusive = 'RangeInclusive', // ..=
  Nullish = 'Nullish',           // ??
  OptionalChain = 'OptionalChain', // ?.

  // Punctuation
  LeftParen = 'LeftParen',       // (
  RightParen = 'RightParen',     // )
  LeftBrace = 'LeftBrace',       // {
  RightBrace = 'RightBrace',     // }
  LeftBracket = 'LeftBracket',   // [
  RightBracket = 'RightBracket', // ]
  Comma = 'Comma',               // ,
  Dot = 'Dot',                   // .
  Colon = 'Colon',               // :
  DoubleColon = 'DoubleColon',   // ::
  Semicolon = 'Semicolon',       // ;
  Question = 'Question',         // ?

  // Special
  Newline = 'Newline',
  Indent = 'Indent',
  Dedent = 'Dedent',
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  lexeme: string;
  literal: string | number | boolean | null;
  line: number;
  column: number;
  start: number;
  end: number;
}

export function createToken(
  type: TokenType,
  lexeme: string,
  literal: string | number | boolean | null,
  line: number,
  column: number,
  start: number,
  end: number
): Token {
  return {
    type,
    lexeme,
    literal,
    line,
    column,
    start,
    end,
  };
}
