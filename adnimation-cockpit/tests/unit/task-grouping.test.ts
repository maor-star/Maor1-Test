import { describe, expect, it } from 'vitest';
import {
  dueBucket, groupTasks, isGroupBy, statusMix, TASK_GROUP_BYS, toneForStatus,
  type Groupable,
} from '@/lib/tasks/grouping';

/**
 * Tasks in groups, the way he reads them in Monday.
 *
 * The order groups come out in is part of the answer, not decoration: a wall
 * that puts DONE above OVERDUE is a wall he has to read rather than scan. So
 * the ordering is pinned here, per column.
 */

const task = (over: Partial<Groupable> & { id: string }): Groupable => ({
  status: 'open',
  priority: 'P2',
  dueDate: null,
  ownerName: null,
  deptNameHe: null,
  ...over,
});

const TODAY = '2026-09-10';

describe('which columns can carry the groups', () => {
  it('offers the five that ask different questions', () => {
    expect([...TASK_GROUP_BYS]).toEqual(['status', 'owner', 'dept', 'due', 'priority']);
  });

  it('refuses anything else, so a hand-edited URL cannot break the screen', () => {
    expect(isGroupBy('status')).toBe(true);
    expect(isGroupBy('owner')).toBe(true);
    expect(isGroupBy('nonsense')).toBe(false);
    expect(isGroupBy(undefined)).toBe(false);
    expect(isGroupBy(null)).toBe(false);
  });
});

describe('grouping by status', () => {
  const rows = [
    task({ id: 'a', status: 'done' }),
    task({ id: 'b', status: 'open' }),
    task({ id: 'c', status: 'blocked' }),
    task({ id: 'd', status: 'open' }),
  ];

  it('runs in workflow order, not alphabetically or by size', () => {
    // OPEN before BLOCKED before DONE, however many are in each.
    expect(groupTasks(rows, 'status', TODAY).map((g) => g.key)).toEqual(['open', 'blocked', 'done']);
  });

  it('puts every row in exactly one group', () => {
    const groups = groupTasks(rows, 'status', TODAY);
    expect(groups.reduce((a, g) => a + g.rows.length, 0)).toBe(rows.length);
  });

  it('carries a status a colour is chosen from', () => {
    expect(toneForStatus('blocked')).toBe('stuck');
    expect(toneForStatus('done')).toBe('done');
    // A status nobody planned for still gets a tone rather than crashing.
    expect(toneForStatus('something-new')).toBe('idle');
  });
});

describe('grouping by due date', () => {
  const rows = [
    task({ id: 'late', dueDate: '2026-09-01' }),
    task({ id: 'today', dueDate: TODAY }),
    task({ id: 'soon', dueDate: '2026-09-15' }),
    task({ id: 'far', dueDate: '2026-12-01' }),
    task({ id: 'none' }),
  ];

  it('reads late first and undated last', () => {
    expect(groupTasks(rows, 'due', TODAY).map((g) => g.key)).toEqual([
      'overdue', 'today', 'week', 'later', 'none',
    ]);
  });

  it('counts the next seven days as this week, not the calendar week', () => {
    // On a Thursday a calendar week has almost nothing left in it, and the
    // question is "what is coming at me", not "what lands before Sunday".
    expect(dueBucket('2026-09-17', TODAY)).toBe('week');
    expect(dueBucket('2026-09-18', TODAY)).toBe('later');
  });

  it('knows yesterday from today', () => {
    expect(dueBucket('2026-09-09', TODAY)).toBe('overdue');
    expect(dueBucket(TODAY, TODAY)).toBe('today');
    expect(dueBucket(null, TODAY)).toBe('none');
  });
});

describe('grouping by owner', () => {
  const rows = [
    task({ id: '1', ownerName: 'Tomer' }),
    task({ id: '2', ownerName: 'Assaf' }),
    task({ id: '3' }),
    task({ id: '4', ownerName: 'Assaf' }),
  ];

  it('is alphabetical, because no owner order is truer than another', () => {
    expect(groupTasks(rows, 'owner', TODAY).map((g) => g.label)).toEqual([
      'Assaf', 'Tomer', 'UNASSIGNED',
    ]);
  });

  it('sorts the empty bucket last however it is spelled', () => {
    // Unassigned is what he is least likely to be looking for, and putting it
    // above a real person's name buries them.
    const zed = [task({ id: '1', ownerName: 'Zohar' }), task({ id: '2' })];
    expect(groupTasks(zed, 'owner', TODAY).map((g) => g.label)).toEqual(['Zohar', 'UNASSIGNED']);
  });
});

describe('the bar across a group', () => {
  const rows = [
    task({ id: '1', status: 'done' }),
    task({ id: '2', status: 'done' }),
    task({ id: '3', status: 'blocked' }),
    task({ id: '4', status: 'open' }),
  ];

  it('divides the group up so the shares fill it exactly', () => {
    const mix = statusMix(rows);
    expect(mix.reduce((a, m) => a + m.share, 0)).toBeCloseTo(1);
    expect(mix.reduce((a, m) => a + m.count, 0)).toBe(4);
  });

  it('runs in workflow order so two groups can be compared', () => {
    // By size, a group's bar would reorder itself every time something moved,
    // and the eye could not compare one group to the next.
    expect(statusMix(rows).map((m) => m.key)).toEqual(['open', 'blocked', 'done']);
  });

  it('says what share is finished', () => {
    const [group] = groupTasks(rows, 'dept', TODAY);
    expect(group!.doneShare).toBe(0.5);
  });

  it('is empty for no rows rather than dividing by zero', () => {
    expect(statusMix([])).toEqual([]);
  });
});

describe('grouping by priority', () => {
  it('reads burning first', () => {
    const rows = [
      task({ id: '1', priority: 'P3' }),
      task({ id: '2', priority: 'P0' }),
      task({ id: '3', priority: 'P2' }),
    ];
    expect(groupTasks(rows, 'priority', TODAY).map((g) => g.key)).toEqual(['P0', 'P2', 'P3']);
  });
});
