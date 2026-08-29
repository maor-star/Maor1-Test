import { z } from 'zod';
import type {
  ClickUpAdapter, ClickUpTask, ClickUpTaskInput, ClickUpTaskResult,
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
      return { ok: false, taskId: null, url: null, error: `http_${res.status}` };
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
}

export function createClickUpAdapter(): ClickUpAdapter {
  const token = process.env.CLICKUP_API_TOKEN;
  const teamId = process.env.CLICKUP_TEAM_ID;
  if (process.env.USE_FAKE_INTEGRATIONS === '1' || !token || !teamId) {
    return new FakeClickUpAdapter();
  }
  return new RealClickUpAdapter(token, teamId);
}
