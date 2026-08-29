'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { Input, Select } from '@/components/ui/input';
import { PRIORITY_META, STATUS_LABEL, TASK_PRIORITIES, TASK_STATUSES } from '@/lib/tasks/types';

interface Current {
  layer: string;
  q: string;
  priority: string;
  status: string;
  dept: string;
  view: string;
}

/** Filters drive the URL, so a filtered view is shareable and survives reload. */
export function TaskFilters({
  departments,
  current,
}: {
  departments: { id: string; label: string }[];
  current: Current;
}) {
  const router = useRouter();

  const push = useCallback(
    (patch: Partial<Current>) => {
      const params = new URLSearchParams();
      const merged = { ...current, ...patch };
      for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
      router.push(`/tasks?${params.toString()}`);
    },
    [current, router],
  );

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border p-2"
      onSubmit={(e) => {
        e.preventDefault();
        const q = new FormData(e.currentTarget).get('q');
        push({ q: String(q ?? '') });
      }}
    >
      <div>
        <label className="block text-2xs text-muted-foreground" htmlFor="q">Search</label>
        <Input id="q" name="q" defaultValue={current.q} placeholder="Title or description" className="w-56" />
      </div>

      <div>
        <label className="block text-2xs text-muted-foreground" htmlFor="layer">Layer</label>
        <Select id="layer" value={current.layer} onChange={(e) => push({ layer: e.target.value })}>
          <option value="mine">My tasks</option>
          <option value="company">Company tasks (ClickUp)</option>
          <option value="all">All</option>
        </Select>
      </div>

      <div>
        <label className="block text-2xs text-muted-foreground" htmlFor="priority">Priority</label>
        <Select id="priority" value={current.priority} onChange={(e) => push({ priority: e.target.value })}>
          <option value="">All</option>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>{p} — {PRIORITY_META[p].label}</option>
          ))}
        </Select>
      </div>

      <div>
        <label className="block text-2xs text-muted-foreground" htmlFor="status">Status</label>
        <Select id="status" value={current.status} onChange={(e) => push({ status: e.target.value })}>
          <option value="">Open</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </Select>
      </div>

      <div>
        <label className="block text-2xs text-muted-foreground" htmlFor="dept">Department</label>
        <Select id="dept" value={current.dept} onChange={(e) => push({ dept: e.target.value })}>
          <option value="">All</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </Select>
      </div>
    </form>
  );
}
