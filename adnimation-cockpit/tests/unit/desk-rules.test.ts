import { describe, expect, it } from 'vitest';
import {
  actLabel, deskId, deskOrder, draftIsCurrent, followUpHome, parseDeskId, urgency,
  type DeskItem,
} from '@/lib/copilot/desk-rules';

const item = (over: Partial<DeskItem> = {}): DeskItem => ({
  id: 'mail:abc',
  channel: 'mail',
  who: 'Ravit',
  title: 'The IO',
  context: '',
  waitingDays: 1,
  url: null,
  entityId: null,
  entityType: null,
  act: 'send',
  target: 'abc',
  fingerprint: '2026-09-01T10:00:00.000Z',
  ...over,
});

describe('what the desk shows first', () => {
  it('puts a contract above a mail that has waited the same time', () => {
    const contract = item({ id: 'contract:1', channel: 'contract', waitingDays: 2 });
    const mail = item({ id: 'mail:1', channel: 'mail', waitingDays: 2 });
    expect(urgency(contract)).toBeGreaterThan(urgency(mail));
  });

  it('lets a mail that has waited a fortnight outrank one that arrived today', () => {
    expect(urgency(item({ waitingDays: 14 }))).toBeGreaterThan(urgency(item({ waitingDays: 0 })));
  });

  it('stops a very old item from burying everything else', () => {
    // Past the patience window, more waiting buys nothing — otherwise a mail
    // from last March sits above everything that arrived this morning for ever.
    const old = urgency(item({ channel: 'task', waitingDays: 400 }));
    expect(old).toBeLessThan(urgency(item({ channel: 'contract', waitingDays: 0 })));
  });

  it('opens with the single most pressing thing', () => {
    const ordered = deskOrder([
      item({ id: 'task:b', channel: 'task', waitingDays: 1 }),
      item({ id: 'contract:a', channel: 'contract', waitingDays: 1 }),
      item({ id: 'task:a', channel: 'task', waitingDays: 1 }),
    ]);
    expect(ordered[0]!.id).toBe('contract:a');
  });

  it('shows one of each channel before a second of any', () => {
    // Twelve contracts used to sit above the first unanswered mail, which is a
    // screen that tells him he has no mail.
    const many = [
      ...Array.from({ length: 12 }, (_, n) =>
        item({ id: `contract:${n}`, channel: 'contract', waitingDays: 5 }),
      ),
      item({ id: 'mail:x', channel: 'mail', waitingDays: 1 }),
      item({ id: 'task:x', channel: 'task', waitingDays: 1 }),
    ];
    const ordered = deskOrder(many);
    expect(ordered.slice(0, 3).map((i) => i.channel)).toEqual(['contract', 'mail', 'task']);
  });

  it('keeps a channel own items loudest first', () => {
    const ordered = deskOrder([
      item({ id: 'task:new', channel: 'task', waitingDays: 1 }),
      item({ id: 'task:old', channel: 'task', waitingDays: 9 }),
    ]);
    expect(ordered.map((i) => i.id)).toEqual(['task:old', 'task:new']);
  });

  it('loses nothing on the way through', () => {
    const many = [
      item({ id: 'mail:1' }),
      item({ id: 'mail:2' }),
      item({ id: 'deal:1', channel: 'deal' }),
      item({ id: 'contract:1', channel: 'contract' }),
    ];
    expect(deskOrder(many)).toHaveLength(4);
    expect(new Set(deskOrder(many).map((i) => i.id)).size).toBe(4);
  });

  it('never counts negative waiting — a due date in the future is not overdue', () => {
    expect(urgency(item({ waitingDays: -5 }))).toBe(urgency(item({ waitingDays: 0 })));
  });
});

describe('the id a draft is filed under', () => {
  it('round-trips', () => {
    expect(parseDeskId(deskId('slack', 'general:1738'))).toEqual({
      channel: 'slack',
      key: 'general:1738',
    });
  });

  it('refuses anything that is not one of ours', () => {
    expect(parseDeskId('nonsense')).toBeNull();
    expect(parseDeskId('kitchen:sink')).toBeNull();
    expect(parseDeskId('mail:')).toBeNull();
    expect(parseDeskId(':abc')).toBeNull();
  });
});

describe('whether a prepared answer still fits', () => {
  it('is current while nothing has moved', () => {
    const one = item();
    expect(draftIsCurrent(one.fingerprint, one)).toBe(true);
  });

  it('is stale the moment they write again', () => {
    const one = item();
    expect(draftIsCurrent('2026-08-30T10:00:00.000Z', one)).toBe(false);
  });

  it('treats nothing stored as nothing prepared', () => {
    expect(draftIsCurrent(null, item())).toBe(false);
    expect(draftIsCurrent(undefined, item())).toBe(false);
    expect(draftIsCurrent('', item())).toBe(false);
  });
});

describe('where the follow-up lives', () => {
  it('goes to the delegation tracker when a person takes it', () => {
    expect(followUpHome(item(), true)).toBe('delegation');
    // Even a deal's move is a delegation once somebody else owns it.
    expect(followUpHome(item({ entityType: 'deal' }), true)).toBe('delegation');
  });

  it('stays on the deal when the deal is the thing', () => {
    expect(followUpHome(item({ channel: 'deal', entityType: 'deal' }), false)).toBe('deal');
  });

  it('becomes a task of his for everything else', () => {
    expect(followUpHome(item(), false)).toBe('task');
    expect(followUpHome(item({ channel: 'contract', entityType: 'contract' }), false)).toBe('task');
  });
});

describe('what the button promises', () => {
  it('says send only where something leaves the company', () => {
    expect(actLabel(item({ act: 'send', channel: 'mail' }))).toBe('SEND THE REPLY');
    expect(actLabel(item({ act: 'send', channel: 'slack' }))).toBe('POST IT');
  });

  it('never says send for something that only files a note', () => {
    expect(actLabel(item({ act: 'do', channel: 'task' }))).toBe('DO IT');
    expect(actLabel(item({ act: 'review', channel: 'contract' }))).toBe('RECORD MY DECISION');
  });
});
