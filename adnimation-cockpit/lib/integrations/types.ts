/**
 * Every external system sits behind an adapter with a fake implementation
 * (CLAUDE.md §9). Tests run against the fakes; CI never touches the network.
 */

export interface SlackMessage {
  /** Slack user id (`U…`) or channel id (`C…`). */
  target: string;
  text: string;
  /** Rendered as a Slack Block Kit context line under the message. */
  contextLines?: string[];
  /** Link back to the originating entity in the cockpit. */
  backlinkUrl?: string;
}

export interface SlackPostResult {
  ok: boolean;
  messageUrl: string | null;
  error?: string;
}

export interface SlackAdapter {
  readonly name: 'slack';
  postMessage(message: SlackMessage): Promise<SlackPostResult>;
}

export interface ClickUpTaskInput {
  listId: string;
  name: string;
  description: string;
  assigneeIds: number[];
  /** ClickUp priority: 1 urgent … 4 low. */
  priority: 1 | 2 | 3 | 4;
  dueDateMs: number | null;
  tags: string[];
}

export interface ClickUpTaskResult {
  ok: boolean;
  taskId: string | null;
  url: string | null;
  error?: string;
}

/** The subset of a ClickUp task the mirror stores (spec 6.1.2). */
export interface ClickUpTask {
  id: string;
  name: string;
  description: string | null;
  status: string;
  priority: 1 | 2 | 3 | 4 | null;
  dueDateMs: number | null;
  startDateMs: number | null;
  parentId: string | null;
  assigneeEmails: string[];
  tags: string[];
  url: string;
  updatedAtMs: number;
}

export interface ClickUpAdapter {
  readonly name: 'clickup';
  createTask(input: ClickUpTaskInput): Promise<ClickUpTaskResult>;
  /** Delta poll: everything changed since `sinceMs` (spec 6.1.2 — every 5 minutes). */
  listTasksUpdatedSince(sinceMs: number): Promise<ClickUpTask[]>;
  getTask(taskId: string): Promise<ClickUpTask | null>;
}
