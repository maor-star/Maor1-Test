import { describe, expect, it } from 'vitest';
import { matchTerms } from '@/lib/delegation/reply-match';
import { FakeSlackAdapter, parsePermalink } from '@/lib/integrations/slack';
import { FakeGmailAdapter } from '@/lib/integrations/gmail';

/**
 * The reply radar's two fiddly parts: getting a channel and a timestamp back
 * out of a Slack permalink, and deciding which words in the ask a real reply
 * would echo. Everything else is a database write.
 */

describe('slack permalinks', () => {
  it('recovers the channel and timestamp', () => {
    expect(parsePermalink('https://slack.com/archives/C08AB12CD/p1756400000000100')).toEqual({
      channel: 'C08AB12CD',
      ts: '1756400000.000100',
    });
  });

  it('returns null for anything that is not a message permalink', () => {
    expect(parsePermalink('https://slack.com/archives/C08AB12CD')).toBeNull();
    expect(parsePermalink('https://example.com/whatever')).toBeNull();
    expect(parsePermalink('')).toBeNull();
  });
});

describe('match terms', () => {
  it('takes the words long enough to be distinctive', () => {
    expect(matchTerms('Chase the Markito invoice', null)).toEqual([
      'Chase',
      'Markito',
      'invoice',
    ]);
  });

  it('drops duplicates and caps the list', () => {
    const terms = matchTerms('renewal renewal renewal', 'renewal contract deadline urgent quickly extra');
    expect(terms).toHaveLength(6);
    expect(new Set(terms).size).toBe(6);
  });

  it('reads Hebrew, which is what the notes are actually written in', () => {
    expect(matchTerms('לבדוק את החוזה מול מרקיטו', null)).toContain('החוזה');
  });

  it('gives nothing back when there is nothing to match on', () => {
    expect(matchTerms(null, null)).toEqual([]);
    expect(matchTerms('a b c', null)).toEqual([]);
  });
});

describe('fake adapters', () => {
  it('the Gmail fake reports itself unconfigured, so the radar says so', async () => {
    const gmail = new FakeGmailAdapter();
    expect(gmail.configured).toBe(false);
    expect(await gmail.findReply()).toBeNull();
  });

  it('the Slack fake hands back one seeded reply and then nothing', async () => {
    const slack = new FakeSlackAdapter();
    slack.nextReply = {
      channel: 'slack',
      author: 'U123',
      excerpt: 'done, sent it this morning',
      at: new Date('2026-08-28T09:00:00Z'),
      url: null,
    };

    expect((await slack.findThreadReply())?.excerpt).toBe('done, sent it this morning');
    expect(await slack.findThreadReply()).toBeNull();
  });
});
