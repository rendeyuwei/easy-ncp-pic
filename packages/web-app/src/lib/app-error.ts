export const APP_ERROR_CODES = [
  'filters-unavailable',
  'filters-stale',
  'file-count',
  'file-type',
  'file-unreadable',
  'dimension-side',
  'dimension-total',
  'worker-start',
  'render-failed',
  'export-failed',
  'export-in-progress',
  'export-no-filter',
  'webgl-fallback',
] as const;

export type AppErrorCode = typeof APP_ERROR_CODES[number];

export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

export function codeForEngineMessage(message: string, phase: 'load' | 'render' | 'export'): AppErrorCode {
  if (phase === 'export') return 'export-failed';
  if (/80,?000,?000|total/i.test(message)) return 'dimension-total';
  if (/10000|side|dimension/i.test(message)) return 'dimension-side';
  if (/worker/i.test(message)) return 'worker-start';
  if (phase === 'render') return 'render-failed';
  return 'file-unreadable';
}
