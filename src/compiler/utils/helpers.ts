export interface PointerRuntimeEvent {
  op:
    | 'own'
    | 'move'
    | 'borrow'
    | 'shared'
    | 'clone'
    | 'drop'
    | 'addr'
    | 'new'
    | 'new[]'
    | 'unique_ptr'
    | 'weak_ptr'
    | 'delete'
    | 'delete[]';
  name: string;
  state: string;
  detail: string;
}

export interface GuiVNodeSnapshot {
  id: string;
  tag: string;
  textContent?: string;
  html?: string;
  attrs: Record<string, string | boolean>;
  style: Record<string, string>;
  children: GuiVNodeSnapshot[];
}

export type VisualOutputItem =
  | { kind: 'html'; content: string }
  | { kind: 'card'; title: string; body: string; footer?: string }
  | { kind: 'table'; columns: string[]; rows: Array<Record<string, unknown>> }
  | { kind: 'chart'; title: string; chartType: string; data: Array<{ label: string; value: number }> }
  | {
      kind: 'yourgui';
      pageId: string;
      title: string;
      styles: string[];
      nodes: GuiVNodeSnapshot[];
    };

export interface RegisteredRouteInfo {
  method: string;
  path: string;
}

export interface DebugVariable {
  name: string;
  value: string;
  type: string;
  scope: string;
}

export interface CallFrame {
  name: string;
  line: number;
}

export interface ExecutionResult {
  logs: string[];
  pointerEvents: PointerRuntimeEvent[];
  visualOutputs?: VisualOutputItem[];
  registeredRoutes?: RegisteredRouteInfo[];
  finalVariables?: DebugVariable[];
  durationMs: number;
  returnValue?: unknown;
  error?: string;
  haltedByExit?: boolean;
}

export interface ExecuteSyncOptions {
  stdin?: string[];
}

export type GuiEventDispatcher = (
  elementId: string,
  eventType: string,
  payload?: { value?: string; checked?: boolean }
) => Promise<void> | void;

import {
  disposeActiveBrowserSandbox,
  runAsyncInSandbox,
  runSyncInSandbox,
} from '../sandbox.ts';

export interface ExecuteAsyncOptions {
  stdin?: string[];
  onLog?: (line: string) => void;
  onInput?: (prompt: string) => Promise<string>;
  onEcho?: (prompt: string, value: string) => void;
  onAlert?: (message: string) => Promise<void> | void;
  onConfirm?: (message: string) => Promise<boolean> | boolean;
  onPrompt?: (message: string, defaultValue?: string) => Promise<string | null> | string | null;
  onBrowser?: (url: string) => void;
  onVisual?: (item: VisualOutputItem) => void;
  onServerStart?: (port: number, routes: RegisteredRouteInfo[]) => void;
  registerGuiDispatcher?: (dispatcher: GuiEventDispatcher) => void;
  signal?: AbortSignal;
}

export { disposeActiveBrowserSandbox };

export function executeCompiledJS(
  code: string,
  options: ExecuteSyncOptions = {}
): ExecutionResult {
  return runSyncInSandbox(code, options);
}

export async function executeCompiledJSAsync(
  code: string,
  options: ExecuteAsyncOptions = {}
): Promise<ExecutionResult> {
  return runAsyncInSandbox(code, options);
}

export function formatTokenLocation(line: number, column: number): string {
  return `${line}:${column}`;
}
