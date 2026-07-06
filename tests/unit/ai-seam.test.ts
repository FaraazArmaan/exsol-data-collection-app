import { describe, it, expect } from 'vitest';
import { ask, cannedResponse } from '../../netlify/functions/_shared/ai';

describe('ask (Claude seam)', () => {
  it('returns a deterministic keyless fallback when ANTHROPIC_API_KEY is absent', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const input = { prompt: 'Summarize the Q3 sales trend for Acme Salon.' };
      const r = await ask(input);
      expect(r.fallback).toBe(true);
      expect(r.model).toBe('dev-fallback');
      expect(r.error).toBeUndefined();
      expect(r.text).toBe(cannedResponse(input));
      expect(r.text).toContain('Summarize the Q3 sales trend');
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it('cannedResponse is deterministic and echoes the prompt head', () => {
    expect(cannedResponse({ prompt: 'hello world' })).toBe(cannedResponse({ prompt: 'hello world' }));
    expect(cannedResponse({ prompt: 'hello world' })).toContain('hello world');
  });
});
