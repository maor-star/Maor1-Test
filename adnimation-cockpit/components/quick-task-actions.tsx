'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { completeTaskAction, snoozeTaskAction } from '@/app/actions/tasks';
import { Button } from '@/components/ui/button';

/**
 * §7 — every list row carries its actions inline, no modal chain.
 * Mirrored ClickUp rows get no write actions: that layer is read-only (6.1.2).
 */
export function QuickTaskActions({ taskId, isMine }: { taskId: string; isMine: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!isMine) {
    return <span className="text-2xs text-muted-foreground">ClickUp</span>;
  }

  const run = (action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, extra?: Record<string, string>) => {
    const fd = new FormData();
    fd.set('id', taskId);
    for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
    startTransition(async () => {
      const result = await action(fd);
      if (!result.ok && result.error) window.alert(result.error);
      router.refresh();
    });
  };

  return (
    <span className="inline-flex gap-1">
      <Button
        size="xs"
        variant="outline"
        disabled={pending}
        onClick={() => run(completeTaskAction)}
        title="סגירת המשימה"
      >
        סגור
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={pending}
        onClick={() => run(snoozeTaskAction, { days: '7' })}
        title="דחייה בשבוע — נספרת לכלל ה-Zombie"
      >
        דחה
      </Button>
    </span>
  );
}
