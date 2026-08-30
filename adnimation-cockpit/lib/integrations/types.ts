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
  /** The conversation the message landed in — a DM channel for a user target. */
  channelId?: string | null;
  /** The message timestamp, which is also the id of the thread it starts. */
  ts?: string | null;
  error?: string;
}

/** One message in a delegation's thread, as the cockpit shows it. */
export interface ThreadMessage {
  ts: string;
  authorId: string | null;
  authorName: string;
  text: string;
  at: Date;
  /** True for the cockpit's own posts, so the conversation reads correctly. */
  fromCockpit: boolean;
}

/** A reply found somewhere else, matched back to the thing it answers. */
export interface FoundReply {
  channel: 'slack' | 'email';
  author: string;
  /** Enough of it to tell an answer from an "on it". */
  excerpt: string;
  at: Date;
  url: string | null;
}

export interface SlackAdapter {
  readonly name: 'slack';
  postMessage(message: SlackMessage): Promise<SlackPostResult>;
  /**
   * The first reply in a thread that is not the cockpit's own message. Given a
   * permalink because that is what the delegation stored when it posted.
   */
  findThreadReply(permalink: string, notFrom?: string): Promise<FoundReply | null>;
  /**
   * Opens a conversation with these people and returns its channel. One user
   * gives a direct message; more than one gives a group conversation, which
   * needs the mpim scopes and fails with missing_scope without them.
   */
  openConversation(userIds: string[]): Promise<{ ok: boolean; channelId: string | null; error?: string }>;
  /** The whole conversation, oldest first, with names resolved. */
  readThread(channelId: string, threadTs: string): Promise<ThreadMessage[]>;
  /** Answer in the thread, as the cockpit's bot. */
  postThreadReply(channelId: string, threadTs: string, text: string): Promise<SlackPostResult>;
}

export interface GmailAdapter {
  readonly name: 'gmail';
  /** Whether the adapter has what it needs to talk to Gmail at all. */
  readonly configured: boolean;
  /**
   * The first message from `fromEmail` after `since` whose subject or body
   * mentions any of `terms`. Terms are how a reply is matched to its ask.
   */
  findReply(input: {
    fromEmail: string;
    since: Date;
    terms: string[];
  }): Promise<FoundReply | null>;
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
  /** The ClickUp list the task sits in — the company's department (see lib/sync/departments.ts). */
  listId: string | null;
  listName: string | null;
  /** Set by ClickUp when a task is closed. Present means finished. */
  dateClosedMs: number | null;
}

export interface ClickUpStatusResult {
  ok: boolean;
  /** The status ClickUp reports after the change, so the mirror stores its word. */
  status: string | null;
  error?: string;
}

export interface ClickUpAdapter {
  readonly name: 'clickup';
  /** The statuses a task's list allows — ClickUp rejects anything else. */
  listStatuses(taskId: string): Promise<string[]>;
  /** Moves a task to a status, or closes it. The one write the cockpit makes. */
  setTaskStatus(taskId: string, status: string): Promise<ClickUpStatusResult>;
  createTask(input: ClickUpTaskInput): Promise<ClickUpTaskResult>;
  /** Delta poll: everything changed since `sinceMs` (spec 6.1.2 — every 5 minutes). */
  listTasksUpdatedSince(sinceMs: number): Promise<ClickUpTask[]>;
  getTask(taskId: string): Promise<ClickUpTask | null>;
}
