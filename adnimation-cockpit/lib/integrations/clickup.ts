import { z } from 'zod';
import type {
  ClickUpAdapter, ClickUpStatusResult, ClickUpTask, ClickUpTaskInput, ClickUpTaskResult,
} from './types';

const API = 'https://api.clickup.com/api/v2';

/**
 * ClickUp changes response shapes without notice, so every field is parsed
 * (CLAUDE.md §10). Anything unrecognised is dropped rather than crashing the sync.
 */
const clickUpTaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  status: z.object({ status: z.string() }).nullish(),
  priority: z.object({ id: z.union([z.string(), z.number()]) }).nullish(),
  due_date: z.union([z.string(), z.number()]).nullish(),
  start_date: z.union([z.string(), z.number()]).nullish(),
  parent: z.string().nullish(),
  assignees: z.array(z.object({ email: z.string().nullish() })).nullish(),
  tags: z.array(z.object({ name: z.string() })).nullish(),
  url: z.string().nullish(),
  date_updated: z.union([z.string(), z.number()]).nullish(),
  date_closed: z.union([z.string(), z.number()]).nullish(),
  list: z.object({ id: z.string().nullish(), name: z.string().nullish() }).nullish(),
});

const listResponseSchema = z.object({
  tasks: z.array(z.unknown()).default([]),
  last_page: z.boolean().optional(),
});

const toMs = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const toPriority = (id: string | number | null | undefined): 1 | 2 | 3 | 4 | null => {
  const n = toMs(id ?? null);
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : null;
};

export function normaliseClickUpTask(raw: unknown): ClickUpTask | null {
  const parsed = clickUpTaskSchema.safeParse(raw);
  if (!parsed.success) return null;
  const t = parsed.data;
  return {
    id: t.id,
    name: t.name,
    description: t.description ?? null,
    status: t.status?.status ?? 'open',
    priority: toPriority(t.priority?.id),
    dueDateMs: toMs(t.due_date),
    startDateMs: toMs(t.start_date),
    parentId: t.parent ?? null,
    assigneeEmails: (t.assignees ?? [])
      .map((a) => a.email)
      .filter((e): e is string => typeof e === 'string' && e.length > 0),
    tags: (t.tags ?? []).map((tag) => tag.name),
    url: t.url ?? `https://app.clickup.com/t/${t.id}`,
    updatedAtMs: toMs(t.date_updated) ?? Date.now(),
    listId: t.list?.id ?? null,
    listName: t.list?.name ?? null,
    dateClosedMs: toMs(t.date_closed),
  };
}

/** ClickUp priority ids: 1 urgent, 2 high, 3 normal, 4 low. Maps onto spec 6.2. */
export const PRIORITY_TO_CLICKUP = { P0: 1, P1: 2, P2: 3, P3: 4 } as const;
export const CLICKUP_TO_PRIORITY = { 1: 'P0', 2: 'P1', 3: 'P2', 4: 'P3' } as const;

class RealClickUpAdapter implements ClickUpAdapter {
  readonly name = 'clickup' as const;

  constructor(
    private readonly token: string,
    private readonly teamId: string,
  ) {}

  private headers() {
    return { Authorization: this.token, 'Content-Type': 'application/json' };
  }

  async createTask(input: ClickUpTaskInput): Promise<ClickUpTaskResult> {
    const res = await fetch(`${API}/list/${input.listId}/task`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        name: input.name,
        description: input.description,
        assignees: input.assigneeIds,
        priority: input.priority,
        due_date: input.dueDateMs,
        tags: input.tags,
      }),
    });
    if (!res.ok) {
      // ClickUp says exactly what it disliked — an invalid list, an assignee
      // who is not a member, a bad priority. Reporting only the status code
      // turns a five-second fix into an investigation.
      const detail = await res.text().catch(() => '');
      let reason = detail.slice(0, 300);
      try {
        const parsedBody = JSON.parse(detail) as { err?: string; ECODE?: string };
        if (parsedBody.err) reason = `${parsedBody.err}${parsedBody.ECODE ? ` (${parsedBody.ECODE})` : ''}`;
      } catch {
        // Not JSON — keep the raw text, which is still better than nothing.
      }
      return {
        ok: false,
        taskId: null,
        url: null,
        error: `http_${res.status}${reason ? `: ${reason}` : ''}`,
      };
    }
    const task = normaliseClickUpTask(await res.json().catch(() => null));
    if (!task) return { ok: false, taskId: null, url: null, error: 'unparseable_response' };
    return { ok: true, taskId: task.id, url: task.url };
  }

  async listTasksUpdatedSince(sinceMs: number): Promise<ClickUpTask[]> {
    const out: ClickUpTask[] = [];
    // ClickUp caps a page at 100 tasks; walk until it says it is the last one.
    for (let page = 0; page < 50; page += 1) {
      const url = new URL(`${API}/team/${this.teamId}/task`);
      url.searchParams.set('date_updated_gt', String(sinceMs));
      url.searchParams.set('subtasks', 'true');
      // Closed tasks are still requested: the cockpit mirrors only open work,
      // and seeing a task close is how the mirror knows to drop its row. Never
      // asking for them would leave finished tasks in the cockpit forever.
      url.searchParams.set('include_closed', 'true');
      url.searchParams.set('page', String(page));
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) throw new Error(`clickup list failed: http_${res.status}`);
      const body = listResponseSchema.parse(await res.json());
      for (const raw of body.tasks) {
        const task = normaliseClickUpTask(raw);
        if (task) out.push(task);
      }
      if (body.tasks.length === 0 || body.last_page) break;
    }
    return out;
  }

  async getTask(taskId: string): Promise<ClickUpTask | null> {
    const res = await fetch(`${API}/task/${taskId}`, { headers: this.headers() });
    if (!res.ok) return null;
    return normaliseClickUpTask(await res.json().catch(() => null));
  }

  /**
   * The statuses this task's list allows. ClickUp rejects a status the list
   * does not define, so the UI offers the list's own words rather than a
   * hardcoded set that would fail on half the workspace.
   */
  async listStatuses(taskId: string): Promise<string[]> {
    const task = await fetch(`${API}/task/${taskId}`, { headers: this.headers() });
    if (!task.ok) return [];
    const body = await task.json().catch(() => null);
    const listId = z
      .object({ list: z.object({ id: z.union([z.string(), z.number()]).nullish() }).nullish() })
      .safeParse(body);
    const id = listId.success ? listId.data.list?.id : null;
    if (id === null || id === undefined) return [];

    const res = await fetch(`${API}/list/${id}`, { headers: this.headers() });
    if (!res.ok) return [];
    const parsed = z
      .object({ statuses: z.array(z.object({ status: z.string() })).default([]) })
      .safeParse(await res.json().catch(() => null));
    return parsed.success ? parsed.data.statuses.map((s) => s.status) : [];
  }

  async setTaskStatus(taskId: string, status: string): Promise<ClickUpStatusResult> {
    const res = await fetch(`${API}/task/${taskId}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, status: null, error: `http_${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}` };
    }
    const task = normaliseClickUpTask(await res.json().catch(() => null));
    return { ok: true, status: task?.status ?? status };
  }
}

/** In-memory ClickUp. Seed it with `seed()`, assert against `created`. */
export class FakeClickUpAdapter implements ClickUpAdapter {
  readonly name = 'clickup' as const;
  readonly created: ClickUpTaskInput[] = [];
  private tasks = new Map<string, ClickUpTask>();
  private nextId = 1;
  failNext = false;

  seed(tasks: ClickUpTask[]): void {
    for (const t of tasks) this.tasks.set(t.id, t);
  }

  async createTask(input: ClickUpTaskInput): Promise<ClickUpTaskResult> {
    if (this.failNext) {
      this.failNext = false;
      return { ok: false, taskId: null, url: null, error: 'fake_failure' };
    }
    const id = `fake-${this.nextId++}`;
    this.created.push(input);
    this.tasks.set(id, {
      id,
      listId: input.listId,
      listName: null,
      dateClosedMs: null,
      name: input.name,
      description: input.description,
      status: 'open',
      priority: input.priority,
      dueDateMs: input.dueDateMs,
      startDateMs: null,
      parentId: null,
      assigneeEmails: [],
      tags: input.tags,
      url: `https://clickup.test/t/${id}`,
      updatedAtMs: Date.now(),
    });
    return { ok: true, taskId: id, url: `https://clickup.test/t/${id}` };
  }

  async listTasksUpdatedSince(sinceMs: number): Promise<ClickUpTask[]> {
    return [...this.tasks.values()].filter((t) => t.updatedAtMs > sinceMs);
  }

  async getTask(taskId: string): Promise<ClickUpTask | null> {
    return this.tasks.get(taskId) ?? null;
  }

  async listStatuses(): Promise<string[]> {
    return ['to do', 'in progress', 'stuck', 'make it happened', 'complete'];
  }

  async setTaskStatus(taskId: string, status: string): Promise<ClickUpStatusResult> {
    if (this.failNext) {
      this.failNext = false;
      return { ok: false, status: null, error: 'fake_failure' };
    }
    const task = this.tasks.get(taskId);
    if (!task) return { ok: false, status: null, error: 'not_found' };
    this.tasks.set(taskId, { ...task, status, dateClosedMs: status === 'complete' ? Date.now() : null });
    return { ok: true, status };
  }
}

export function createClickUpAdapter(): ClickUpAdapter {
  const token = process.env.CLICKUP_API_TOKEN;
  const teamId = process.env.CLICKUP_TEAM_ID;
  if (process.env.USE_FAKE_INTEGRATIONS === '1' || !token || !teamId) {
    return new FakeClickUpAdapter();
  }
  return new RealClickUpAdapter(token, teamId);
}
