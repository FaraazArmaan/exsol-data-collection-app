// Single Claude API seam for the whole platform. Every AI-powered feature calls
// ask({ system, prompt, images? }) and gets back text — no module talks to the
// Anthropic API directly.
//
// Uses the official @anthropic-ai/sdk (pure JS — bundles like zod/neon, needs NO
// external_node_modules entry, unlike sharp/@node-rs/argon2).
//
// No ANTHROPIC_API_KEY (dev / CI / tests) → a deterministic canned response, so
// every AI feature demos keyless. ask() NEVER throws: a provider error also falls
// back to the canned response (with `error` set), so a flaky LLM can't 500 the
// caller's request.
import Anthropic from '@anthropic-ai/sdk';

export type AskImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
export interface AskImage { mediaType: AskImageMediaType; dataBase64: string }

export interface AskInput {
  prompt: string;
  system?: string;
  images?: AskImage[];
  /** Override the model per-call (e.g. 'claude-haiku-4-5' for cheap/fast tasks). */
  model?: string;
  maxTokens?: number;
}

export interface AskResult {
  text: string;
  model: string;
  /** true when the deterministic dev fallback produced the text (no key, or an error). */
  fallback: boolean;
  /** Set when a live call was attempted but failed. */
  error?: string;
}

// Default per the claude-api guidance — do not downgrade for cost here; callers
// that want a cheaper model pass `model`.
const DEFAULT_MODEL = 'claude-opus-4-8';
const DEFAULT_MAX_TOKENS = 1024;

/** Deterministic, key-free stand-in so AI features render in dev / demo / tests. */
export function cannedResponse(input: AskInput): string {
  const head = input.prompt.trim().split(/\s+/).slice(0, 24).join(' ');
  const ellipsis = input.prompt.trim().length > head.length ? '…' : '';
  return `[AI preview — set ANTHROPIC_API_KEY for live output] ${head}${ellipsis}`;
}

export async function ask(input: AskInput): Promise<AskResult> {
  const model = input.model ?? DEFAULT_MODEL;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { text: cannedResponse(input), model: 'dev-fallback', fallback: true };

  try {
    const client = new Anthropic({ apiKey: key });
    const content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];
    for (const img of input.images ?? []) {
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.dataBase64 } });
    }
    content.push({ type: 'text', text: input.prompt });

    const resp = await client.messages.create({
      model,
      max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(input.system ? { system: input.system } : {}),
      messages: [{ role: 'user', content }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { text, model: resp.model, fallback: false };
  } catch (e) {
    // Never throw into the caller — degrade to the canned response.
    return { text: cannedResponse(input), model: 'dev-fallback', fallback: true, error: String((e as Error)?.message ?? e) };
  }
}
