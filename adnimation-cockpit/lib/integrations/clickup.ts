import { z } from 'zod';
import type {
  ClickUpAdapter, ClickUpAttachment, ClickUpStatusResult, ClickUpTask, ClickUpTaskInput,
  ClickUpTaskPatch, ClickUpTaskResult, ClickUpUpdateResult,
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

/**
 * An attachment, as ClickUp reports it on a task.
 *
 * `url_w_query` carries the signature that makes the URL fetchable; `url`
 * alone is refused. Both are optional in the wild — a file still uploading has
 * neither — and a row without one is not shown rather than shown broken.
 */
const attachmentSchema = z.object({
  id: z.string(),
  title: z.string().nullish(),
  extension: z.string().nullish(),
  mimetype: z.string().nullish(),
  size: z.union([z.string(), z.number()]).nullish(),
  url: z.string().nullish(),
  url_w_query: z.string().nullish(),
  thumbnail_medium: z.string().nullish(),
  thumbnail_large: z.string().nullish(),
});

const taskWithAttachmentsSchema = z.object({
  attachments: z.array(attachmentSchema).default([]),
});

/** ClickUp often reports no mime type at all; the extension is the fallback. */
const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', heic: 'image/heic',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

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

  /**
   * The edit write-through.
   *
   * Only the fields present are sent: ClickUp treats an absent key as "leave
   * it", and a null due date as "clear it", which is exactly the distinction
   * the cockpit's form needs. Sending the whole task back would overwrite
   * whatever the team changed in the meantime with what his page happened to
   * be showing.
   */
  async updateTask(taskId: string, patch: ClickUpTaskPatch): Promise<ClickUpUpdateResult> {
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.description !== undefined) body.description = patch.description ?? '';
    if (patch.priority !== undefined) body.priority = patch.priority;
    if (patch.dueDateMs !== undefined) body.due_date = patch.dueDateMs;
    if (Object.keys(body).length === 0) return { ok: true };

    const res = await fetch(`${API}/task/${taskId}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };

    // ClickUp says exactly what it disliked; the status code alone turns a
    // five-second fix into an investigation.
    const detail = await res.text().catch(() => '');
    let reason = detail.slice(0, 300);
    try {
      const parsed = JSON.parse(detail) as { err?: string; ECODE?: string };
      if (parsed.err) reason = `${parsed.err}${parsed.ECODE ? ` (${parsed.ECODE})` : ''}`;
    } catch {
      // Not JSON — the raw text is still better than nothing.
    }
    return { ok: false, error: `http_${res.status}${reason ? `: ${reason}` : ''}` };
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

  /** The attachments live on the single-task response, not on the team list. */
  private async attachmentsOf(taskId: string) {
    const res = await fetch(`${API}/task/${taskId}`, { headers: this.headers() });
    if (!res.ok) return [];
    const parsed = taskWithAttachmentsSchema.safeParse(await res.json().catch(() => null));
    return parsed.success ? parsed.data.attachments : [];
  }

  async listAttachments(taskId: string): Promise<ClickUpAttachment[]> {
    const out: ClickUpAttachment[] = [];
    for (const a of await this.attachmentsOf(taskId)) {
      if (!a.url_w_query && !a.url) continue;
      const name = a.title ?? `attachment.${a.extension ?? 'bin'}`;
      const ext = (a.extension ?? name.split('.').pop() ?? '').toLowerCase();
      const size = typeof a.size === 'number' ? a.size : Number(a.size ?? NaN);
      out.push({
        id: a.id,
        name,
        mimeType: a.mimetype || MIME_BY_EXTENSION[ext] || 'application/octet-stream',
        sizeBytes: Number.isFinite(size) ? size : null,
        thumbnailUrl: a.thumbnail_medium ?? a.thumbnail_large ?? null,
      });
    }
    return out;
  }

  async readAttachment(
    taskId: string,
    attachmentId: string,
  ): Promise<{ body: Buffer; mimeType: string; name: string } | null> {
    const found = (await this.attachmentsOf(taskId)).find((a) => a.id === attachmentId);
    const href = found?.url_w_query ?? found?.url;
    if (!found || !href) return null;

    // No API token here: the signature in the URL is the credential, and
    // ClickUp's file host rejects the Authorization header outright.
    const res = await fetch(href);
    if (!res.ok) return null;

    const name = found.title ?? `attachment.${found.extension ?? 'bin'}`;
    const ext = (found.extension ?? name.split('.').pop() ?? '').toLowerCase();
    return {
      body: Buffer.from(await res.arrayBuffer()),
      mimeType:
        found.mimetype
        || res.headers.get('content-type')
        || MIME_BY_EXTENSION[ext]
        || 'application/octet-stream',
      name,
    };
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
  /** Tests set these; a workspace with no files simply shows none. */
  attachments: ClickUpAttachment[] = [];
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

  /** Tests assert against this. */
  readonly updates: { taskId: string; patch: ClickUpTaskPatch }[] = [];
  failNextUpdate = false;

  async updateTask(taskId: string, patch: ClickUpTaskPatch): Promise<ClickUpUpdateResult> {
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      return { ok: false, error: 'fake_failure' };
    }
    const task = this.tasks.get(taskId);
    if (!task) return { ok: false, error: 'not_found' };

    this.updates.push({ taskId, patch });
    this.tasks.set(taskId, {
      ...task,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.dueDateMs !== undefined ? { dueDateMs: patch.dueDateMs } : {}),
    });
    return { ok: true };
  }

  async listAttachments(_taskId: string): Promise<ClickUpAttachment[]> {
    return this.attachments;
  }

  async readAttachment(
    _taskId: string,
    _attachmentId: string,
  ): Promise<{ body: Buffer; mimeType: string; name: string } | null> {
    return null;
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
