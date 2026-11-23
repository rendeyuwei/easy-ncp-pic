import { describe, expect, it } from 'vitest';
import { AppError, codeForEngineMessage } from '../lib/app-error';
import { messages } from '../lib/messages';

describe('stable error codes', () => {
  it('maps engine messages without showing the raw text', () => {
    expect(codeForEngineMessage('Image total 85500000 pixels exceeds the 80000000 pixel limit', 'load'))
      .toBe('dimension-total');
    expect(codeForEngineMessage('Image dimension 10001px exceeds the 10000px side limit', 'load'))
      .toBe('dimension-side');
    expect(codeForEngineMessage('Web Workers are unavailable', 'load')).toBe('worker-start');
    expect(codeForEngineMessage('context lost', 'render')).toBe('render-failed');
    expect(codeForEngineMessage('out of memory', 'export')).toBe('export-failed');
    expect(codeForEngineMessage('not an image', 'load')).toBe('file-unreadable');
    expect(messages.zh.errors['export-failed']).toBe('导出失败。编辑状态已保留，请重试。');
    expect(messages.en.errors['export-failed']).not.toContain('out of memory');
    expect(new AppError('export-in-progress', messages.zh.errors['export-in-progress']).code)
      .toBe('export-in-progress');
  });
});
