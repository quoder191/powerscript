import { TokenType } from './tokens.ts';

export const KEYWORDS: Record<string, TokenType> = {
  // Declarations
  let: TokenType.Let,
  var: TokenType.Var,
  const: TokenType.Const,
  fn: TokenType.Fn,
  function: TokenType.Fn,
  return: TokenType.Return,

  // OOP & Algebraic Types
  class: TokenType.Class,
  struct: TokenType.Struct,
  enum: TokenType.Enum,
  trait: TokenType.Trait,
  interface: TokenType.Trait,
  implements: TokenType.Implements,
  extends: TokenType.Extends,
  init: TokenType.Init,
  constructor: TokenType.Init,
  self: TokenType.Self,
  this: TokenType.Self,
  super: TokenType.Super,
  pub: TokenType.Pub,
  priv: TokenType.Priv,
  prot: TokenType.Prot,
  static: TokenType.Static,
  override: TokenType.Override,
  new: TokenType.New,

  // Smart & Rule Pointers
  own: TokenType.Own,
  ref: TokenType.Ref,
  shared: TokenType.Shared,
  move: TokenType.Move,
  borrow: TokenType.Borrow,
  drop: TokenType.Drop,

  // Control Flow
  if: TokenType.If,
  elif: TokenType.Elif,
  else: TokenType.Else,
  for: TokenType.For,
  in: TokenType.In,
  while: TokenType.While,
  loop: TokenType.Loop,
  repeat: TokenType.Repeat,
  times: TokenType.Times,
  break: TokenType.Break,
  continue: TokenType.Continue,
  match: TokenType.Match,
  case: TokenType.Case,
  default: TokenType.Default,
  try: TokenType.Try,
  catch: TokenType.Catch,
  throw: TokenType.Throw,
  defer: TokenType.Defer,
  scope: TokenType.Scope,

  // Logical & Type Operators
  and: TokenType.And,
  or: TokenType.Or,
  not: TokenType.Not,
  is: TokenType.Is,
  as: TokenType.As,

  // Modules
  import: TokenType.Import,
  export: TokenType.Export,
  from: TokenType.From,

  // Literals
  true: TokenType.BoolLiteral,
  false: TokenType.BoolLiteral,
  null: TokenType.NullLiteral,
  none: TokenType.NullLiteral,
  nullptr: TokenType.NullLiteral,
};

export const BUILTIN_TYPES = new Set<string>([
  'int',
  'float',
  'number',
  'str',
  'string',
  'text',
  'bool',
  'boolean',
  'void',
  'any',
  'list',
  'array',
  'map',
  'dict',
  'stack',
  'queue',
  'set',
  'ptr',
  'own',
  'ref',
  'shared',
  'option',
]);

export function lookupKeyword(identifier: string): TokenType | undefined {
  return Object.prototype.hasOwnProperty.call(KEYWORDS, identifier)
    ? KEYWORDS[identifier]
    : undefined;
}
