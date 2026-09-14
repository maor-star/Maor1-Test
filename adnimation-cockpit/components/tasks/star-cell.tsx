'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setTaskPrivateAction } from '@/app/actions/task-access';

/**
 * The star: this one is mine.
 *
 * A starred task is filtered out in the query for everybody else, so this
 * control is the whole of the privacy decision and it has to be unmistakable.
 * Filled and gold means private; an empty outline means the people he has
 * given access to can see it.
 *
 * Only he sees this at all — for anyone else there is nothing to press, since
 * a task they can see is by definition one that is not private.
 */
export function StarCell({
  taskId,
  isPrivate,
}: {
  taskId: string;
  isPrivate: boolean;
}) {
  const [on, setOn] = useState(isPrivate);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? 'Private — only you can see this' : 'Shared with the people you gave access'}
      title={on ? 'Private — only you can see this' : 'Visible to the people you gave access'}
      disabled={pending}
      onClick={() => {
        const next = !on;
        // Flipped straight away: he is scanning a list and marking several,
        // and waiting for a round trip on each one makes the list feel stuck.
        setOn(next);
        const data = new FormData();
        data.set('id', taskId);
        data.set('isPrivate', String(next));
        startTransition(async () => {
          const result = await setTaskPrivateAction(data);
          // Back to what it was if the server refused. A star showing private
          // on a task that is not is the one wrong state that matters here.
          if (!result.ok) setOn(!next);
          else router.refresh();
        });
      }}
      className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[15px] leading-none transition-colors ${
        on ? 'text-[#d4a017]' : 'text-neutral-300 hover:text-neutral-500'
      } ${pending ? 'opacity-60' : ''}`}
    >
      <span aria-hidden>{on ? '★' : '☆'}</span>
    </button>
  );
}
