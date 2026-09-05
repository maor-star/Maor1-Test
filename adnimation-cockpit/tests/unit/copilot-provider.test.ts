import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { providerStatus, resolveProvider, PROVIDER_LABEL } from '@/lib/copilot/provider';

/**
 * Which model answers the Copilot.
 *
 * He asked for the chat to run on Gemini and said he would paste the key
 * himself. So the interesting cases are all about the gap between those two
 * moments: the preference has changed but the key is not in yet, and the
 * screen still has to answer.
 *
 * Both providers read the cockpit through the same tools, so this decides who
 * is asked, never what they can see.
 */

const KEYS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'COPILOT_PROVIDER'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('what "auto" picks', () => {
  it('is Gemini when both keys are there', () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.GEMINI_API_KEY = 'g';
    expect(providerStatus().auto).toBe('gemini');
  });

  it('falls back to Claude while there is no Gemini key yet', () => {
    // The whole point: he changed the preference before pasting the key, and
    // the screen must keep answering rather than going dark.
    process.env.ANTHROPIC_API_KEY = 'a';
    expect(providerStatus().auto).toBe('anthropic');
  });

  it('is Gemini when it is the only key', () => {
    process.env.GEMINI_API_KEY = 'g';
    expect(providerStatus().auto).toBe('gemini');
  });

  it('is nothing at all when neither key is set', () => {
    // Not a guess at a provider that cannot answer — the chat says so instead.
    expect(providerStatus().auto).toBe(null);
  });

  it('can be pinned back to Claude without a deploy', () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.GEMINI_API_KEY = 'g';
    process.env.COPILOT_PROVIDER = 'anthropic';
    expect(providerStatus().auto).toBe('anthropic');
  });
});

describe('what the picker reports', () => {
  it('says which keys are present', () => {
    process.env.GEMINI_API_KEY = 'g';
    const s = providerStatus();
    expect(s.gemini).toBe(true);
    expect(s.anthropic).toBe(false);
  });

  it('never offers a provider whose key is missing', () => {
    // The option is disabled in the UI; this is the server refusing as well,
    // because a disabled option is a suggestion and this is the rule.
    process.env.GEMINI_API_KEY = 'g';
    expect(resolveProvider('anthropic')).toBe(null);
    expect(resolveProvider('gemini')).toBe('gemini');
  });

  it('treats anything else as auto', () => {
    process.env.GEMINI_API_KEY = 'g';
    expect(resolveProvider('auto')).toBe('gemini');
    expect(resolveProvider(null)).toBe('gemini');
    expect(resolveProvider('something-else')).toBe('gemini');
  });

  it('names both in the words on the screen', () => {
    expect(PROVIDER_LABEL.gemini).toBe('Gemini');
    expect(PROVIDER_LABEL.anthropic).toBe('Claude');
  });
});
