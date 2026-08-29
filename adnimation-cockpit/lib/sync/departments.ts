import type { DeptCode } from '@/lib/tasks/types';

/**
 * The company's departments are its ClickUp lists.
 *
 * Every task lives in exactly one list, and that list is the department that
 * owns it — so the department comes from the data rather than from a rule
 * somebody has to maintain. A list nobody has mapped yet leaves the task
 * without a department rather than being folded into the wrong one.
 *
 * Note this is a different axis from the revenue departments in
 * lib/revenue/departments.ts, which are the source's demand categories. One
 * answers "who does the work", the other "where does the money come from".
 */

export const CLICKUP_LIST_DEPTS: { listId: string; listName: string; deptCode: DeptCode }[] = [
  { listId: '901817617754', listName: 'Core Publishers', deptCode: 'CORE' },
  { listId: '901817617598', listName: 'Video', deptCode: 'VID' },
  { listId: '901817617759', listName: 'Trading', deptCode: 'TRADING' },
  { listId: '901817617772', listName: 'Seat Lease', deptCode: 'SEAT' },
  { listId: '901817703208', listName: 'Bidder', deptCode: 'BID' },
  { listId: '901817617786', listName: 'General', deptCode: 'GENERAL' },
  { listId: '901817957808', listName: 'HR', deptCode: 'HR' },
  { listId: '901819118715', listName: 'Demand', deptCode: 'DEMAND' },
  { listId: '901819118752', listName: 'Marketing', deptCode: 'MKT' },
  { listId: '901819118774', listName: 'Finance', deptCode: 'FIN' },
  { listId: '901819118787', listName: 'Development', deptCode: 'DEV' },
];

/**
 * The department a ClickUp list belongs to. Matches on id first — a list can be
 * renamed without the id changing — then falls back to the name so a list
 * recreated with the same name still lands in the right place.
 */
export function deptForList(
  listId: string | null,
  listName: string | null,
): DeptCode | null {
  if (listId) {
    const byId = CLICKUP_LIST_DEPTS.find((l) => l.listId === listId);
    if (byId) return byId.deptCode;
  }
  if (listName) {
    const wanted = listName.trim().toLowerCase();
    const byName = CLICKUP_LIST_DEPTS.find((l) => l.listName.toLowerCase() === wanted);
    if (byName) return byName.deptCode;
  }
  return null;
}
