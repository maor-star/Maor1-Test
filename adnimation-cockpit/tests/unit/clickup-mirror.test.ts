import { describe, expect, it } from 'vitest';
import { isFinished, mapClickUpStatus, toMirrorRow } from '@/lib/sync/clickup-map';
import { CLICKUP_LIST_DEPTS, deptForList } from '@/lib/sync/departments';
import { normaliseClickUpTask } from '@/lib/integrations/clickup';
import type { ClickUpTask } from '@/lib/integrations/types';

const task = (over: Partial<ClickUpTask> = {}): ClickUpTask => ({
  id: 'abc123',
  name: 'Check the sellers.json',
  description: 'Some description',
  status: 'in progress',
  priority: 2,
  dueDateMs: Date.parse('2026-09-10T00:00:00Z'),
  startDateMs: null,
  parentId: null,
  assigneeEmails: ['tomer@adnimation.com'],
  tags: ['supply'],
  url: 'https://app.clickup.com/t/abc123',
  updatedAtMs: Date.parse('2026-08-29T08:00:00Z'),
  listId: '901817617786',
  listName: 'General',
  dateClosedMs: null,
  ...over,
});

describe('mapClickUpStatus', () => {
  it('folds the common done spellings onto one status', () => {
    for (const s of ['Complete', 'closed', 'DONE']) expect(mapClickUpStatus(s)).toBe('done');
  });

  it('maps in-progress variants', () => {
    for (const s of ['in progress', 'In-Progress', 'doing']) {
      expect(mapClickUpStatus(s)).toBe('in_progress');
    }
  });

  it('maps blocked variants', () => {
    for (const s of ['Blocked', 'on hold', 'waiting']) expect(mapClickUpStatus(s)).toBe('blocked');
  });

  it('maps open variants', () => {
    for (const s of ['Open', 'to do', 'backlog']) expect(mapClickUpStatus(s)).toBe('open');
  });

  it('passes an unknown custom status through, slugified', () => {
    expect(mapClickUpStatus('Pending Legal Review')).toBe('pending_legal_review');
  });
});

describe('toMirrorRow', () => {
  it('maps a full task onto the mirror shape', () => {
    const row = toMirrorRow(task());
    expect(row).toMatchObject({
      clickupId: 'abc123',
      title: 'Check the sellers.json',
      status: 'in_progress',
      priority: 'P1',
      dueDate: '2026-09-10',
      ownerEmail: 'tomer@adnimation.com',
      tags: ['supply'],
    });
  });

  it('maps every ClickUp priority id onto the spec 6.2 scale', () => {
    expect(toMirrorRow(task({ priority: 1 })).priority).toBe('P0');
    expect(toMirrorRow(task({ priority: 2 })).priority).toBe('P1');
    expect(toMirrorRow(task({ priority: 3 })).priority).toBe('P2');
    expect(toMirrorRow(task({ priority: 4 })).priority).toBe('P3');
  });

  it('defaults an unset ClickUp priority to P2 rather than P0', () => {
    expect(toMirrorRow(task({ priority: null })).priority).toBe('P2');
  });

  it('keeps a null due date null instead of inventing an epoch date', () => {
    expect(toMirrorRow(task({ dueDateMs: null })).dueDate).toBeNull();
  });

  it('takes the first assignee as owner and tolerates none', () => {
    expect(toMirrorRow(task({ assigneeEmails: [] })).ownerEmail).toBeNull();
    expect(toMirrorRow(task({ assigneeEmails: ['a@x.com', 'b@x.com'] })).ownerEmail).toBe('a@x.com');
  });
});

describe('normaliseClickUpTask', () => {
  it('parses a realistic API payload', () => {
    const parsed = normaliseClickUpTask({
      id: '9xyz',
      name: 'Renew IO with PubMatic',
      description: null,
      status: { status: 'open' },
      priority: { id: '1' },
      due_date: '1789000000000',
      start_date: null,
      parent: null,
      assignees: [{ email: 'ravit@adnimation.com' }],
      tags: [{ name: 'contract' }],
      url: 'https://app.clickup.com/t/9xyz',
      date_updated: '1788000000000',
    });
    expect(parsed).toMatchObject({
      id: '9xyz',
      status: 'open',
      priority: 1,
      assigneeEmails: ['ravit@adnimation.com'],
      tags: ['contract'],
    });
  });

  it('returns null instead of throwing on a payload missing required fields', () => {
    expect(normaliseClickUpTask({ name: 'no id' })).toBeNull();
    expect(normaliseClickUpTask(null)).toBeNull();
    expect(normaliseClickUpTask('nonsense')).toBeNull();
  });

  it('survives unexpected extra fields and null-ish optionals', () => {
    const parsed = normaliseClickUpTask({
      id: '1', name: 'x', brand_new_field: { nested: true }, status: null, priority: null,
    });
    expect(parsed).toMatchObject({ id: '1', status: 'open', priority: null });
  });

  it('drops a priority id outside the documented 1-4 range', () => {
    expect(normaliseClickUpTask({ id: '1', name: 'x', priority: { id: 9 } })?.priority).toBeNull();
  });

  it('falls back to a constructed url when ClickUp omits one', () => {
    expect(normaliseClickUpTask({ id: 'zz', name: 'x' })?.url).toBe('https://app.clickup.com/t/zz');
  });
});

describe('isFinished', () => {
  it('treats a closed task as finished', () => {
    expect(isFinished(task({ dateClosedMs: Date.parse('2026-08-20T00:00:00Z') }))).toBe(true);
  });

  it('treats a done status as finished even when ClickUp set no close date', () => {
    // A workspace can complete work by moving it to a custom status; relying on
    // date_closed alone would leave those tasks in the cockpit forever.
    for (const s of ['Complete', 'closed', 'DONE']) {
      expect(isFinished(task({ status: s, dateClosedMs: null }))).toBe(true);
    }
  });

  it('leaves open work alone', () => {
    for (const s of ['to do', 'in progress', 'stuck', 'make it happened']) {
      expect(isFinished(task({ status: s }))).toBe(false);
    }
  });

  it('marks the row so the mirror can drop it', () => {
    expect(toMirrorRow(task({ status: 'closed' })).finished).toBe(true);
    expect(toMirrorRow(task()).finished).toBe(false);
  });
});

describe('deptForList', () => {
  it('maps every ClickUp list the company works in', () => {
    for (const l of CLICKUP_LIST_DEPTS) {
      expect(deptForList(l.listId, null)).toBe(l.deptCode);
      expect(deptForList(null, l.listName)).toBe(l.deptCode);
    }
  });

  it('prefers the id, so a renamed list keeps its department', () => {
    expect(deptForList('901817703208', 'Bidder (renamed)')).toBe('BID');
  });

  it('matches a name case-insensitively, for a list recreated under the same name', () => {
    expect(deptForList('999', '  general  ')).toBe('GENERAL');
  });

  it('leaves a list nobody has mapped without a department rather than guessing', () => {
    expect(deptForList('999', 'Something New')).toBeNull();
    expect(deptForList(null, null)).toBeNull();
  });

  it('carries the list through to the mirror row', () => {
    const row = toMirrorRow(task({ listId: '901819118774', listName: 'Finance' }));
    expect(deptForList(row.listId, row.listName)).toBe('FIN');
  });
});
