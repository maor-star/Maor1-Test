'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addCommentAction } from '@/app/actions/tasks';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';

export function CommentForm({ taskId }: { taskId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <form
      ref={formRef}
      className="space-y-1.5 border-t pt-2"
      action={(formData) => {
        startTransition(async () => {
          const result = await addCommentAction(formData);
          setError(result.ok ? null : (result.error ?? 'הוספת ההערה נכשלה'));
          if (result.ok) {
            formRef.current?.reset();
            router.refresh();
          }
        });
      }}
    >
      <input type="hidden" name="taskId" value={taskId} />
      <Textarea name="body" rows={2} required placeholder="הוספת הערה" />
      {error ? <p className="text-2xs text-destructive">{error}</p> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'שומר…' : 'הוספה'}
      </Button>
    </form>
  );
}
