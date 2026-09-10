import { afterEach, describe, expect, it } from 'vitest';
import { matchTerms } from '@/lib/delegation/reply-match';
import { createSlackAdapter, explainPostError, FakeSlackAdapter, parsePermalink } from '@/lib/integrations/slack';
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

/**
 * A reply that was never in a thread.
 *
 * The reply radar read `conversations.replies` and nothing else, which is not
 * how anybody answers a direct message. A hand-over to one person goes to
 * their DM, and a person replying in a DM types into the conversation — they
 * do not hover the message and pick "reply in thread". So the answer arrived,
 * sat in the DM, and the tracker said nobody had replied until it marked the
 * whole thing stale three days later.
 *
 * That was the state of the one real hand-over on the board: sent to Assaf in
 * a DM, with nothing that would have noticed an answer.
 */
describe('finding an answer that is not in the thread', () => {
  const PERMALINK = 'https://slack.com/archives/D0BV2LP6PMZ/p1788640763076759';
  const PARENT_TS = '1788640763.076759';

  /** Slack that answers each endpoint from a script. */
  const slackWith = (thread: unknown[], history: unknown[]) => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      const which = String(url).includes('conversations.replies') ? thread : history;
      return { json: async () => ({ ok: true, messages: which }) } as unknown as Response;
    }) as unknown as typeof fetch;
    return calls;
  };

  const ours = { ts: PARENT_TS, bot_id: 'B0BTP2HGH8A', text: 'לטיפולך בבקשה ועדכן.' };
  const theirs = { ts: '1788700000.000100', user: 'U0Y3M6LFM', text: 'בסדר, אני על זה' };

  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const realFetch = globalThis.fetch;

  it('reads the conversation when the thread holds only our own message', async () => {
    const calls = slackWith([ours], [ours, theirs]);
    const found = await createSlackAdapter('xoxb-test').findThreadReply(PERMALINK);
    expect(found?.excerpt).toBe('בסדר, אני על זה');
    expect(found?.author).toBe('U0Y3M6LFM');

    /*
     * That it went to the conversation at all, not only the thread. Without
     * this the suite would keep passing if a future change swapped the real
     * adapter for the fake one — the assertions above would be checking a stub
     * against itself.
     */
    expect(calls.some((c) => c.includes('conversations.replies'))).toBe(true);
    expect(calls.some((c) => c.includes('conversations.history'))).toBe(true);
  });

  it('still prefers a threaded reply, which is unambiguously about this ask', async () => {
    const inThread = { ts: '1788650000.000100', user: 'U0Y3M6LFM', text: 'בתוך הת׳רד' };
    slackWith([ours, inThread], [ours, theirs]);
    const found = await createSlackAdapter('xoxb-test').findThreadReply(PERMALINK);
    expect(found?.excerpt).toBe('בתוך הת׳רד');
  });

  it('never reads our own message back as their answer', async () => {
    slackWith([ours], [ours]);
    expect(await createSlackAdapter('xoxb-test').findThreadReply(PERMALINK)).toBe(null);
  });

  it('reports the first answer, not the latest remark', async () => {
    const later = { ts: '1788800000.000100', user: 'U0Y3M6LFM', text: 'ועוד משהו' };
    // Slack hands history back newest first.
    slackWith([ours], [later, theirs, ours]);
    const found = await createSlackAdapter('xoxb-test').findThreadReply(PERMALINK);
    expect(found?.excerpt).toBe('בסדר, אני על זה');
  });

  it('leaves out somebody it was told to ignore', async () => {
    slackWith([ours], [ours, theirs]);
    expect(await createSlackAdapter('xoxb-test').findThreadReply(PERMALINK, 'U0Y3M6LFM')).toBe(null);
  });
});

/**
 * What a failed channel post tells him to do.
 *
 * The cockpit can list all 79 public channels and post to none of them: Slack
 * only lets an app post where it is a member, unless it holds
 * chat:write.public. Tested against the live workspace with a scheduled
 * message that was deleted before it could appear — `not_in_channel`.
 *
 * So a hand-over to a channel offers seventy-nine and then fails, and the bare
 * word "not_in_channel" sends him looking at the channel instead of at the one
 * scope that fixes all of them at once.
 */
describe('when a post to a channel is refused', () => {
  it('names the scope that fixes every channel at once', () => {
    const said = explainPostError('not_in_channel');
    expect(said).toContain('chat:write.public');
    expect(said).toContain('Reinstall');
    // The raw word stays, so a search for it still lands here.
    expect(said).toContain('not_in_channel');
  });

  it('tells a private channel apart, where the scope will not help', () => {
    // chat:write.public covers public channels only; a private one has to
    // invite the bot, so pointing him at the scope would waste his time.
    expect(explainPostError('channel_not_found')).toContain('/invite');
    expect(explainPostError('channel_not_found')).not.toContain('chat:write.public');
  });

  it('leaves an error it has nothing to add to alone', () => {
    expect(explainPostError('rate_limited')).toBe('rate_limited');
  });
});
