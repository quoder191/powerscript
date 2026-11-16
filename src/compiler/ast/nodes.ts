export type Visibility = 'pub' | 'priv' | 'prot';

export type PointerMode = 'own' | 'ref' | 'shared' | 'ptr' | 'cpp_ref' | 'unique' | 'weak';

export interface SourcePosition {
  line: number;
  column: number;
}

export interface TypeAnnotationNode extends SourcePosition {
  kind: 'TypeAnnotation';
  name: string;
  generics: TypeAnnotationNode[];
  nullable: boolean;
  unionTypes?: TypeAnnotationNode[];
  isPointer?: number;
  isReference?: boolean;
  isConst?: boolean;
  isConstPointer?: boolean;
}

export interface ParamNode extends SourcePosition {
  kind: 'Param';
  name: string;
  typeAnnotation?: TypeAnnotationNode;
  defaultValue?: ExpressionNode;
}

// ============================================================================
// Statements & Declarations
// ============================================================================

export type StatementNode =
  | VarDeclarationNode
  | MultiVarDeclarationNode
  | FunctionDeclarationNode
  | ClassDeclarationNode
  | StructDeclarationNode
  | EnumDeclarationNode
  | TraitDeclarationNode
  | ImportStatementNode
  | BlockStatementNode
  | IfStatementNode
  | ForInStatementNode
  | CForStatementNode
  | WhileStatementNode
  | DoWhileStatementNode
  | LoopStatementNode
  | RepeatStatementNode
  | ReturnStatementNode
  | BreakStatementNode
  | ContinueStatementNode
  | TryCatchStatementNode
  | ThrowStatementNode
  | DeferStatementNode
  | DropStatementNode
  | ScopeStatementNode
  | StyleStatementNode
  | ExpressionStatementNode;

export interface ProgramNode extends SourcePosition {
  kind: 'Program';
  body: StatementNode[];
}

export interface VarDeclarationNode extends SourcePosition {
  kind: 'VarDeclaration';
  mutable: boolean;
  pointerMode?: PointerMode;
  name: string;
  typeAnnotation?: TypeAnnotationNode;
  initializer?: ExpressionNode;
}

export interface MultiVarDeclarationNode extends SourcePosition {
  kind: 'MultiVarDeclaration';
  mutable: boolean;
  declarations: VarDeclarationNode[];
}

export interface ImportStatementNode extends SourcePosition {
  kind: 'ImportStatement';
  modulePath: string;
  defaultImport?: string;
  namedImports: string[];
  alias?: string;
}

export interface FunctionDeclarationNode extends SourcePosition {
  kind: 'FunctionDeclaration';
  name: string;
  genericParams?: string[];
  params: ParamNode[];
  returnType?: TypeAnnotationNode;
  body: BlockStatementNode;
  isExported: boolean;
}

export interface ClassFieldNode extends SourcePosition {
  kind: 'ClassField';
  visibility: Visibility;
  isStatic: boolean;
  name: string;
  typeAnnotation?: TypeAnnotationNode;
  initializer?: ExpressionNode;
}

export interface ClassMethodNode extends SourcePosition {
  kind: 'ClassMethod';
  visibility: Visibility;
  isStatic: boolean;
  isOverride: boolean;
  isConstructor: boolean;
  name: string;
  params: ParamNode[];
  returnType?: TypeAnnotationNode;
  body: BlockStatementNode;
}

export interface ClassDeclarationNode extends SourcePosition {
  kind: 'ClassDeclaration';
  name: string;
  genericParams?: string[];
  superClass?: string;
  traits: string[];
  fields: ClassFieldNode[];
  methods: ClassMethodNode[];
}

export interface StructFieldNode extends SourcePosition {
  kind: 'StructField';
  name: string;
  typeAnnotation?: TypeAnnotationNode;
  defaultValue?: ExpressionNode;
}

export interface StructDeclarationNode extends SourcePosition {
  kind: 'StructDeclaration';
  name: string;
  genericParams?: string[];
  fields: StructFieldNode[];
  methods: ClassMethodNode[];
}

export interface EnumVariantNode extends SourcePosition {
  kind: 'EnumVariant';
  name: string;
  fields: string[];
}

export interface EnumDeclarationNode extends SourcePosition {
  kind: 'EnumDeclaration';
  name: string;
  variants: EnumVariantNode[];
}

export interface TraitMethodSignatureNode extends SourcePosition {
  kind: 'TraitMethodSignature';
  name: string;
  params: ParamNode[];
  returnType?: TypeAnnotationNode;
}

export interface TraitDeclarationNode extends SourcePosition {
  kind: 'TraitDeclaration';
  name: string;
  genericParams?: string[];
  methods: TraitMethodSignatureNode[];
}

export interface BlockStatementNode extends SourcePosition {
  kind: 'BlockStatement';
  statements: StatementNode[];
}

export interface ElifBranch extends SourcePosition {
  condition: ExpressionNode;
  consequent: BlockStatementNode;
}

export interface IfStatementNode extends SourcePosition {
  kind: 'IfStatement';
  condition: ExpressionNode;
  consequent: BlockStatementNode;
  elifBranches: ElifBranch[];
  alternate?: BlockStatementNode;
}

export interface ForInStatementNode extends SourcePosition {
  kind: 'ForInStatement';
  variable: string;
  iterable: ExpressionNode;
  body: BlockStatementNode;
}

export interface CForStatementNode extends SourcePosition {
  kind: 'CForStatement';
  init?: StatementNode;
  condition?: ExpressionNode;
  update?: ExpressionNode;
  body: BlockStatementNode;
}

export interface WhileStatementNode extends SourcePosition {
  kind: 'WhileStatement';
  condition: ExpressionNode;
  body: BlockStatementNode;
}

export interface DoWhileStatementNode extends SourcePosition {
  kind: 'DoWhileStatement';
  body: BlockStatementNode;
  condition: ExpressionNode;
}

export interface LoopStatementNode extends SourcePosition {
  kind: 'LoopStatement';
  body: BlockStatementNode;
}

export interface RepeatStatementNode extends SourcePosition {
  kind: 'RepeatStatement';
  count: ExpressionNode;
  body: BlockStatementNode;
}

export interface ReturnStatementNode extends SourcePosition {
  kind: 'ReturnStatement';
  value?: ExpressionNode;
}

export interface BreakStatementNode extends SourcePosition {
  kind: 'BreakStatement';
}

export interface ContinueStatementNode extends SourcePosition {
  kind: 'ContinueStatement';
}

export interface TryCatchStatementNode extends SourcePosition {
  kind: 'TryCatchStatement';
  tryBlock: BlockStatementNode;
  catchVar?: string;
  catchBlock: BlockStatementNode;
}

export interface ThrowStatementNode extends SourcePosition {
  kind: 'ThrowStatement';
  value: ExpressionNode;
}

export interface DeferStatementNode extends SourcePosition {
  kind: 'DeferStatement';
  statement: StatementNode;
}

export interface DropStatementNode extends SourcePosition {
  kind: 'DropStatement';
  target: ExpressionNode;
  isArrayDelete?: boolean;
}

export interface ScopeStatementNode extends SourcePosition {
  kind: 'ScopeStatement';
  name?: string;
  body: BlockStatementNode;
}

export interface StyleStatementNode extends SourcePosition {
  kind: 'StyleStatement';
  css: string;
}

export interface ExpressionStatementNode extends SourcePosition {
  kind: 'ExpressionStatement';
  expression: ExpressionNode;
}

// ============================================================================
// Expressions
// ============================================================================

export type ExpressionNode =
  | IdentifierNode
  | SelfExpressionNode
  | SuperExpressionNode
  | LiteralNode
  | FStringNode
  | ArrayLiteralNode
  | MapLiteralNode
  | BinaryExpressionNode
  | UnaryExpressionNode
  | UpdateExpressionNode
  | LogicalExpressionNode
  | ConditionalExpressionNode
  | AssignmentExpressionNode
  | CallExpressionNode
  | MemberExpressionNode
  | IndexExpressionNode
  | NewExpressionNode
  | StructInitExpressionNode
  | LambdaExpressionNode
  | RangeExpressionNode
  | PipeExpressionNode
  | MatchExpressionNode
  | PointerExpressionNode;

export interface ConditionalExpressionNode extends SourcePosition {
  kind: 'ConditionalExpression';
  condition: ExpressionNode;
  consequent: ExpressionNode;
  alternate: ExpressionNode;
}

export interface IdentifierNode extends SourcePosition {
  kind: 'Identifier';
  name: string;
}

export interface SelfExpressionNode extends SourcePosition {
  kind: 'SelfExpression';
}

export interface SuperExpressionNode extends SourcePosition {
  kind: 'SuperExpression';
}

export interface LiteralNode extends SourcePosition {
  kind: 'Literal';
  literalType: 'int' | 'float' | 'str' | 'bool' | 'null';
  value: string | number | boolean | null;
}

export interface FStringPartText {
  kind: 'text';
  value: string;
}

export interface FStringPartExpr {
  kind: 'expr';
  expression: ExpressionNode;
}

export type FStringPart = FStringPartText | FStringPartExpr;

export interface FStringNode extends SourcePosition {
  kind: 'FString';
  raw: string;
  parts: FStringPart[];
}

export interface ArrayLiteralNode extends SourcePosition {
  kind: 'ArrayLiteral';
  elements: ExpressionNode[];
}

export interface MapEntryNode {
  key: ExpressionNode;
  value: ExpressionNode;
}

export interface MapLiteralNode extends SourcePosition {
  kind: 'MapLiteral';
  entries: MapEntryNode[];
}

export interface BinaryExpressionNode extends SourcePosition {
  kind: 'BinaryExpression';
  operator: string;
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface UnaryExpressionNode extends SourcePosition {
  kind: 'UnaryExpression';
  operator: string;
  operand: ExpressionNode;
}

export interface UpdateExpressionNode extends SourcePosition {
  kind: 'UpdateExpression';
  operator: '++' | '--';
  argument: ExpressionNode;
  prefix: boolean;
}

export interface LogicalExpressionNode extends SourcePosition {
  kind: 'LogicalExpression';
  operator: 'and' | 'or' | '??';
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface AssignmentExpressionNode extends SourcePosition {
  kind: 'AssignmentExpression';
  operator: '=' | '+=' | '-=' | '*=' | '/=';
  target: ExpressionNode;
  value: ExpressionNode;
}

export interface CallExpressionNode extends SourcePosition {
  kind: 'CallExpression';
  callee: ExpressionNode;
  args: ExpressionNode[];
}

export interface MemberExpressionNode extends SourcePosition {
  kind: 'MemberExpression';
  object: ExpressionNode;
  property: string;
  optional: boolean;
}

export interface IndexExpressionNode extends SourcePosition {
  kind: 'IndexExpression';
  object: ExpressionNode;
  index: ExpressionNode;
}

export interface NewExpressionNode extends SourcePosition {
  kind: 'NewExpression';
  className: string;
  args: ExpressionNode[];
  countExpr?: ExpressionNode;
}

export interface StructInitField {
  name: string;
  value: ExpressionNode;
}

export interface StructInitExpressionNode extends SourcePosition {
  kind: 'StructInitExpression';
  structName: string;
  fields: StructInitField[];
}

export interface LambdaExpressionNode extends SourcePosition {
  kind: 'LambdaExpression';
  params: ParamNode[];
  body: BlockStatementNode | ExpressionNode;
}

export interface RangeExpressionNode extends SourcePosition {
  kind: 'RangeExpression';
  start: ExpressionNode;
  end: ExpressionNode;
  inclusive: boolean;
}

export interface PipeExpressionNode extends SourcePosition {
  kind: 'PipeExpression';
  left: ExpressionNode;
  right: ExpressionNode;
}

export type MatchPattern =
  | { kind: 'WildcardPattern' }
  | { kind: 'LiteralPattern'; value: string | number | boolean | null }
  | { kind: 'RangePattern'; start: number; end: number; inclusive: boolean }
  | { kind: 'EnumPattern'; enumName?: string; variant: string; bindings: string[] }
  | { kind: 'BindingPattern'; name: string };

export interface MatchArmNode extends SourcePosition {
  pattern: MatchPattern;
  body: BlockStatementNode | ExpressionNode;
}

export interface MatchExpressionNode extends SourcePosition {
  kind: 'MatchExpression';
  subject: ExpressionNode;
  arms: MatchArmNode[];
}

export interface PointerExpressionNode extends SourcePosition {
  kind: 'PointerExpression';
  op: 'own' | 'shared' | 'borrow' | 'move' | 'deref' | 'addr' | 'sizeof';
  argument: ExpressionNode;
  sizeofTypeName?: string;
}
