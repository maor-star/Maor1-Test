import { afterAll, describe, expect, it } from 'vitest';
import { escapeCommentary, FakePublisher } from '@/lib/marketing/linkedin';
import { FakeImageMaker, promptFromPost } from '@/lib/marketing/images';
import {
  drawImage, imageOf, publishDraft, removeImage, riskyBits, storeDraft, MAX_POST_CHARS,
} from '@/lib/marketing/service';
import { setSecret } from '@/lib/secrets/store';
import { AGENT_SETTINGS, effectiveSettings } from '@/lib/agents/settings';
import { SEED_AGENTS } from '@/lib/agents/definitions';
import { ACTION_TYPES, IRREVERSIBLE_ACTIONS, isIrreversible } from '@/lib/agents/types';

/**
 * The marketing agent.
 *
 * Its one dangerous property is that its output can leave the company, so the
 * tests are mostly about the wall between writing and publishing: the agent
 * has no action that publishes, and the thing that does is not reachable from
 * an agent at all.
 */

describe('the agent writes, and cannot publish', () => {
  const agent = SEED_AGENTS.find((a) => a.name === 'marketing-writer');

  it('is on the roster, off, at level 1', () => {
    expect(agent).toBeDefined();
    expect(agent!.enabled).toBe(false);
    expect(agent!.autonomyLevel).toBe(1);
  });

  it('holds one action, and it only drafts', () => {
    expect(agent!.actions.map((a) => a.type)).toEqual(['draft_linkedin_posts']);
    expect(isIrreversible('draft_linkedin_posts')).toBe(false);
  });

  it('has no publishing action to hold — there is none in the system', () => {
    const publishing = (ACTION_TYPES as readonly string[]).filter((t) => /linkedin|publish|post_public/i.test(t));
    expect(publishing).toEqual(['draft_linkedin_posts']);
    // And sending something outward stays on the irreversible list, where
    // level 4 can never reach it.
    expect(IRREVERSIBLE_ACTIONS).toContain('send_external_document');
  });

  it('waits for a model and for something to have happened', () => {
    expect(agent!.conditions.map((c) => c.check)).toEqual(['copilot_configured', 'marketing_material']);
  });

  it('comes with its dials, and does not name clients unless he says so', () => {
    expect(Object.keys(AGENT_SETTINGS)).toContain('marketing-writer');
    const eff = effectiveSettings('marketing-writer', {});
    expect(eff.nameClients).toBe(false);
    expect(eff.sources).toEqual(['contracts', 'deals']);
    expect(eff.language).toBe('en');
    expect(effectiveSettings('marketing-writer', { nameClients: true }).nameClients).toBe(true);
  });
});

describe('what gets flagged before it goes out', () => {
  it('flags a figure, a percentage and a commercial term', () => {
    expect(riskyBits('We crossed $2M this quarter')[0]).toMatch(/figure/);
    expect(riskyBits('Fill rate up 34% since launch').some((f) => /percentage/.test(f))).toBe(true);
    expect(riskyBits('A better rev share than anyone').some((f) => /commercial term/.test(f))).toBe(true);
    expect(riskyBits('Still under NDA').some((f) => /confidential/.test(f))).toBe(true);
  });

  it('leaves an ordinary post alone', () => {
    expect(riskyBits('A new publisher went live with us this week. Good week.')).toEqual([]);
  });

  it('flags rather than edits — the text is never changed behind his back', () => {
    const text = 'We crossed $2M this quarter';
    expect(riskyBits(text).length).toBeGreaterThan(0);
    expect(text).toBe('We crossed $2M this quarter');
  });
});

describe('publishing', () => {
  it('escapes the punctuation LinkedIn treats as markup', () => {
    expect(escapeCommentary('Adnimation (finally) live with @partner')).toBe(
      'Adnimation \\(finally\\) live with \\@partner',
    );
    expect(escapeCommentary('nothing to escape here')).toBe('nothing to escape here');
  });

  it('hands back the link when it worked', async () => {
    const linkedIn = new FakePublisher();
    const out = await linkedIn.publish('Hello', { token: 't', author: 'urn:li:person:x' });
    expect(out.ok).toBe(true);
    expect(out.url).toBe('https://linkedin.test/1');
    expect(linkedIn.posted).toEqual(['Hello']);
  });

  it('says so when LinkedIn refuses, and posts nothing', async () => {
    const linkedIn = new FakePublisher();
    linkedIn.failWith = 'LinkedIn refused it (401)';
    const out = await linkedIn.publish('Hello', { token: 't', author: 'urn:li:person:x' });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/401/);
    expect(linkedIn.posted).toEqual([]);
  });

  it('stops at the length LinkedIn stops at', () => {
    expect(MAX_POST_CHARS).toBe(3000);
  });
});

// The fake LinkedIn credentials must not outlive the run: a later hand test
// of the publish button would otherwise find "connected" and post nowhere.
afterAll(async () => {
  await setSecret('LINKEDIN_ACCESS_TOKEN', '', 'test@adnimation.com');
  await setSecret('LINKEDIN_AUTHOR_URN', '', 'test@adnimation.com');
});

describe('a picture for the post', () => {
  it('writes the prompt from the post when he gave none, in the house style', () => {
    const p = promptFromPost('A new publisher went live with us.\nMore below.', 'Signed with X');
    expect(p).toContain('A new publisher went live with us.');
    expect(p).toContain('Signed with X');
    expect(p).toMatch(/no text, no logos/);
  });

  it('draws, keeps the prompt, serves the bytes, and goes out with the post', async () => {
    const id = await storeDraft({ sourceKind: 'manual', sourceRef: `img-${Date.now()}`, occasion: 'Image test', body: 'Words.' });
    expect(id).toBeTruthy();
    const gemini = new FakeImageMaker();

    // His own prompt is used as written.
    const drawn = await drawImage(id!, 'a lighthouse', 'test@adnimation.com', gemini.make);
    expect(drawn.ok).toBe(true);
    expect(gemini.prompts).toEqual(['a lighthouse']);

    const served = await imageOf(id!);
    expect(served?.mime).toBe('image/png');
    expect(served?.bytes.length).toBeGreaterThan(10);

    // No prompt: one is derived from the post.
    await drawImage(id!, '   ', 'test@adnimation.com', gemini.make);
    expect(gemini.prompts[1]).toContain('Words.');

    // Publishing carries the picture, as alt-texted media.
    await setSecret('LINKEDIN_ACCESS_TOKEN', 'test-token', 'test@adnimation.com');
    await setSecret('LINKEDIN_AUTHOR_URN', 'urn:li:person:test', 'test@adnimation.com');
    const linkedIn = new FakePublisher();
    const out = await publishDraft(id!, 'test@adnimation.com', linkedIn.publish);
    expect(out.ok).toBe(true);
    expect(linkedIn.images[0]?.mime).toBe('image/png');
    expect(linkedIn.images[0]?.title).toBe('Image test');
  });

  it('can be taken off again, and says so when Gemini fails', async () => {
    const id = await storeDraft({ sourceKind: 'manual', sourceRef: `img2-${Date.now()}`, occasion: 'Image test 2', body: 'Words.' });
    const gemini = new FakeImageMaker();
    await drawImage(id!, null, 'test@adnimation.com', gemini.make);
    expect(await imageOf(id!)).not.toBeNull();
    expect((await removeImage(id!, 'test@adnimation.com')).ok).toBe(true);
    expect(await imageOf(id!)).toBeNull();

    gemini.failWith = 'Gemini declined the prompt (SAFETY).';
    const failed = await drawImage(id!, 'x', 'test@adnimation.com', gemini.make);
    expect(failed.ok).toBe(false);
    expect(failed.error).toMatch(/declined/);
    expect(await imageOf(id!)).toBeNull();
  });
});
