import { describe, expect, it, beforeEach } from 'vitest';
import { FakeSlackAdapter } from '@/lib/integrations/slack';
import type { SlackChannel, SlackHit, ThreadMessage } from '@/lib/integrations/types';
import {
  forgetSlackChannels, postToSlack, readSlack, resolveChannel,
} from '@/lib/copilot/slack-view';
import { DECISION_KINDS, NEVER_AUTOMATIC, executableKinds } from '@/lib/copilot/autopilot';
import { WRITE_TOOLS } from '@/lib/copilot/service';
import { TOOL_SPECS, READ_TOOL_SPECS } from '@/lib/copilot/tools';
import { AGENT_SETTINGS, effectiveSettings } from '@/lib/agents/settings';

/**
 * The copilot's Slack.
 *
 * Two promises, and they pull in opposite directions on purpose: it reads
 * broadly — every channel the cockpit is in, without being told which — and it
 * writes narrowly, only where he named and only when he said so.
 */

const channel = (over: Partial<SlackChannel> & { id: string; name: string }): SlackChannel => ({
  isPrivate: false,
  isMember: true,
  readable: true,
  topic: null,
  purpose: null,
  memberCount: 10,
  ...over,
});

const said = (text: string, author = 'Ravit', minutesAgo = 5): ThreadMessage => ({
  ts: `${Math.floor((Date.now() - minutesAgo * 60_000) / 1000)}.000100`,
  authorId: 'U1',
  authorName: author,
  text,
  at: new Date(Date.now() - minutesAgo * 60_000),
  fromCockpit: false,
});

function workspace() {
  const slack = new FakeSlackAdapter();
  slack.channels = [
    channel({ id: 'C-SALES', name: 'sales', memberCount: 20 }),
    channel({ id: 'C-SALES-EU', name: 'sales-eu', memberCount: 4 }),
    channel({ id: 'C-OPS', name: 'ops', memberCount: 12 }),
    channel({ id: 'C-RANDOM', name: 'random', isMember: false, readable: false, memberCount: 60 }),
    channel({ id: 'G-BOARD', name: 'board', isPrivate: true, memberCount: 3 }),
  ];
  slack.history.set('C-SALES', [said('BlueX signed the MSA', 'Ravit', 30), said('Sending the IO now', 'Yossi', 20)]);
  slack.history.set('C-SALES-EU', [said('Nothing from Berlin yet', 'Dana', 60)]);
  slack.history.set('C-OPS', [said('The bidder is at 99.9% again', 'Ilan', 120)]);
  slack.history.set('G-BOARD', [said('Board pack on Sunday', 'Maor', 200)]);
  return slack;
}

beforeEach(forgetSlackChannels);

describe('naming a channel', () => {
  const all = workspace().channels;

  it('takes it with or without the hash, in any case', () => {
    expect(resolveChannel('#sales', all)?.id).toBe('C-SALES');
    expect(resolveChannel('Sales', all)?.id).toBe('C-SALES');
    expect(resolveChannel('C-OPS', all)?.id).toBe('C-OPS');
  });

  it('prefers the exact name over the one it is a prefix of', () => {
    // Both `sales` and `sales-eu` start with "sales"; he meant `sales`.
    expect(resolveChannel('sales', all)?.name).toBe('sales');
    expect(resolveChannel('sales-e', all)?.name).toBe('sales-eu');
  });

  it('gives nothing back for a name no channel has', () => {
    expect(resolveChannel('marketing', all)).toBeNull();
    expect(resolveChannel('', all)).toBeNull();
  });
});

describe('reading', () => {
  it('reads one channel when he names it', async () => {
    const out = await readSlack({ channel: '#sales' }, workspace());
    expect(out.channelsRead).toEqual(['sales']);
    expect(out.lines.map((l) => l.text)).toContain('BlueX signed the MSA');
    expect(out.lines[0]?.url).toMatch(/archives\/C-SALES\/p/);
  });

  it('sweeps the channels the cockpit is in when he names none', async () => {
    const out = await readSlack({ maxChannels: 4 }, workspace());
    expect(out.channelsRead).toContain('sales');
    expect(out.channelsRead).toContain('ops');
    expect(out.channelsRead).toContain('board');
    expect(out.lines.length).toBeGreaterThan(3);
  });

  it('never reads a channel the cockpit was not added to', async () => {
    const out = await readSlack({ channel: 'random' }, workspace());
    expect(out.channelsRead).toEqual([]);
    expect(out.skipped[0]?.why).toMatch(/never added/);
    // And it is not in the sweep either.
    const sweep = await readSlack({}, workspace());
    expect(sweep.channelsRead).not.toContain('random');
  });

  it('filters to what he asked about, and to the last hours', async () => {
    const byWord = await readSlack({ q: 'msa' }, workspace());
    expect(byWord.lines).toHaveLength(1);
    expect(byWord.lines[0]?.channel).toBe('sales');

    const recent = await readSlack({ sinceHours: 1 }, workspace());
    expect(recent.lines.map((l) => l.text)).not.toContain('Board pack on Sunday');
  });

  it('newest first, whichever channel it came from', async () => {
    const out = await readSlack({}, workspace());
    const times = out.lines.map((l) => l.at.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('carries on past a channel that will not open', async () => {
    const slack = workspace();
    slack.readChannel = async (id: string) => {
      if (id === 'C-OPS') throw new Error('not_in_channel');
      return slack.history.get(id) ?? [];
    };
    const out = await readSlack({}, slack);
    expect(out.channelsRead).toContain('sales');
    expect(out.skipped).toContainEqual({ channel: 'ops', why: 'not_in_channel' });
  });
});

describe('searching, when he has pasted his own token', () => {
  const hits: SlackHit[] = [
    {
      channelId: 'C-LEGAL', channelName: 'legal', authorName: 'Elki',
      text: 'The BlueX MSA is with legal', at: new Date(Date.now() - 3 * 3_600_000), url: 'https://slack.test/legal/1',
    },
    {
      channelId: 'C-SALES', channelName: 'sales', authorName: 'Ravit',
      text: 'BlueX signed the MSA', at: new Date(Date.now() - 30 * 60_000), url: 'https://slack.test/sales/1',
    },
  ];

  it('asks Slack rather than sweeping, so it sees channels the cockpit is not in', async () => {
    const slack = workspace();
    slack.searchable = hits;
    const out = await readSlack({ q: 'MSA' }, slack);
    expect(out.searched).toBe(true);
    // #legal is nowhere in the channel list, and the answer still has it.
    expect(out.lines.map((l) => l.channel)).toEqual(['sales', 'legal']);
    expect(out.lines[0]?.url).toBe('https://slack.test/sales/1');
  });

  it('falls back to reading the channels it can when search is not allowed', async () => {
    const slack = workspace();
    slack.searchable = null; // a bot token, which Slack will not let search
    const out = await readSlack({ q: 'msa' }, slack);
    expect(out.searched).toBe(false);
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]?.channel).toBe('sales');
  });
});

describe('posting', () => {
  it('posts to the channel he named and hands back the link', async () => {
    const slack = workspace();
    const out = await postToSlack('#ops', 'Deploying at 18:00.', slack);
    expect(out.ok).toBe(true);
    expect(out.channel).toBe('ops');
    expect(slack.sent[0]?.target).toBe('C-OPS');
    expect(slack.sent[0]?.text).toBe('Deploying at 18:00.');
  });

  it('refuses a channel it cannot post in, and posts nothing', async () => {
    const slack = workspace();
    expect((await postToSlack('random', 'hello', slack)).ok).toBe(false);
    expect((await postToSlack('marketing', 'hello', slack)).ok).toBe(false);
    expect(slack.sent).toHaveLength(0);
  });

  it('refuses an empty message and one too long for Slack', async () => {
    const slack = workspace();
    expect((await postToSlack('ops', '   ', slack)).ok).toBe(false);
    expect((await postToSlack('ops', 'x'.repeat(3001), slack)).ok).toBe(false);
    expect(slack.sent).toHaveLength(0);
  });

  it('reports Slack refusing it rather than claiming it posted', async () => {
    const slack = workspace();
    slack.failNext = true;
    const out = await postToSlack('ops', 'hello', slack);
    expect(out.ok).toBe(false);
    expect(out.error).toBe('fake_failure');
  });
});

describe('the autopilot may propose a Slack message, never send one', () => {
  it('keeps slack out of what it can do on its own, at every level and dial', () => {
    for (const level of [1, 2, 3, 4]) {
      const may = executableKinds(level, { mayAct: [...DECISION_KINDS] });
      expect(may.has('slack'), `level ${level}`).toBe(false);
    }
    expect(NEVER_AUTOMATIC).toContain('slack');
  });

  it('still carries out the kinds he did allow', () => {
    const may = executableKinds(2, { mayAct: ['task', 'alert', 'slack'] });
    expect([...may].sort()).toEqual(['alert', 'task']);
  });

  it('offers him the channels dial, empty by default', () => {
    const eff = effectiveSettings('autopilot', {});
    expect(eff.slackChannels).toBe('');
    expect(effectiveSettings('autopilot', { slackChannels: 'sales, ops' }).slackChannels).toBe('sales, ops');
    expect(eff.scope).toContain('slack');
  });

  it('does not offer posting as something it may do unattended', () => {
    const field = AGENT_SETTINGS.autopilot?.find((f) => f.key === 'mayAct');
    const options = field && field.type === 'multi' ? field.options.map((o) => o.value) : [];
    expect(options).not.toContain('slack');
  });
});

describe('the tools the model is handed', () => {
  it('offers reading in the read set and posting only in the write set', () => {
    const read = READ_TOOL_SPECS.map((t) => t.name);
    const all = TOOL_SPECS.map((t) => t.name);
    expect(read).toContain('read_slack');
    expect(read).toContain('slack_channels');
    expect(read).not.toContain('post_slack');
    expect(all).toContain('post_slack');
  });

  it('counts posting as a change, so its use on a thread is audited', () => {
    expect(WRITE_TOOLS.has('post_slack')).toBe(true);
  });
});
