import { Inngest } from 'inngest';

/**
 * All scheduled work runs here, never in a route handler and never on
 * setInterval (CLAUDE.md §3). Durable, retryable, observable.
 */
export const inngest = new Inngest({
  id: 'adnimation-cockpit',
  eventKey: process.env.INNGEST_EVENT_KEY,
});

export type CockpitEvents = {
  'clickup/task.changed': { data: { taskId: string } };
  'task/hygiene.violation': { data: { taskId: string; code: string } };
  'delegation/stale': { data: { delegationId: string } };
};
