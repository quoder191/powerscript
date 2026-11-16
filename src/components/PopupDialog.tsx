import React, { useEffect, useRef, useState } from 'react';

export type PopupRequest =
  | { kind: 'alert'; message: string; resolve: () => void }
  | { kind: 'confirm'; message: string; resolve: (accepted: boolean) => void }
  | {
      kind: 'prompt';
      message: string;
      defaultValue: string;
      resolve: (value: string | null) => void;
    };

interface PopupDialogProps {
  request: PopupRequest | null;
}

export function PopupDialog({ request }: PopupDialogProps) {
  const [promptInput, setPromptInput] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const okButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!request) return;
    if (request.kind === 'prompt') {
      setPromptInput(request.defaultValue);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    } else {
      requestAnimationFrame(() => {
        okButtonRef.current?.focus();
      });
    }
  }, [request]);

  if (!request) return null;

  const handleConfirm = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (request.kind === 'alert') {
      request.resolve();
    } else if (request.kind === 'confirm') {
      request.resolve(true);
    } else {
      request.resolve(promptInput);
    }
  };

  const handleCancel = () => {
    if (request.kind === 'alert') {
      request.resolve();
    } else if (request.kind === 'confirm') {
      request.resolve(false);
    } else {
      request.resolve(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  const title =
    request.kind === 'alert'
      ? 'Alert'
      : request.kind === 'confirm'
        ? 'Confirm'
        : 'Prompt';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-[1px] p-4"
      onKeyDown={handleKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="easyjs-popup-title"
        className="w-full max-w-md rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 flex items-center justify-between">
          <h2
            id="easyjs-popup-title"
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            {title}
          </h2>
          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
            {request.kind}()
          </span>
        </div>

        <form onSubmit={handleConfirm} className="p-5 space-y-4">
          <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words">
            {request.message}
          </p>

          {request.kind === 'prompt' && (
            <input
              ref={inputRef}
              type="text"
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              aria-label={request.message || 'Prompt input'}
              className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-md focus:outline-none focus:border-emerald-600"
            />
          )}

          <div className="flex items-center justify-end gap-2.5 pt-1">
            {request.kind !== 'alert' && (
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
              >
                {request.kind === 'confirm' ? 'Cancel (No)' : 'Cancel'}
              </button>
            )}
            <button
              ref={okButtonRef}
              type="submit"
              className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              {request.kind === 'confirm' ? 'Yes (OK)' : 'OK'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
