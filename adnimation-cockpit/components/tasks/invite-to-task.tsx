'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { inviteToTasksAction } from '@/app/actions/invite';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { ACCESS_LEVELS, LEVEL_LABEL } from '@/lib/tasks/access';

/**
 * Sending somebody this task, and the way in with it.
 *
 * The gear at the top of the board invites a person to the board. This invites
 * them to a TASK: the mail carries the task itself — title, status, priority,
 * due date, who else is on it, the description — so the person knows what they
 * are being asked before they have clicked anything, and the link is how they
 * answer rather than how they find out.
 *
 * A starred task is never quoted in a mail. The star means it is his alone,
 * and an invitation containing one would put it in somebody's inbox for good.
 */
export function InviteToTask({ taskId, isPrivate }: { taskId: string; isPrivate: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11.5px] font-semibold text-info hover:underline"
      >
        + Invite somebody to this task
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-[10px] border border-info/40 bg-info/5 p-2.5">
      <p className="hud-label text-[10.5px] text-info">Invite somebody to this task</p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[11rem] flex-1">
          <span className="hud-label block text-[10.5px]">Their email</span>
          <Input
            dir="ltr"
            type="email"
            placeholder="name@company.com"
            className="mt-1 h-9 w-full text-[13px]"
            id={`invite-email-${taskId}`}
          />
        </label>
        <label className="min-w-[7rem]">
          <span className="hud-label block text-[10.5px]">Their name</span>
          <Input className="mt-1 h-9 w-full text-[13px]" id={`invite-name-${taskId}`} />
        </label>
        <label>
          <span className="hud-label block text-[10.5px]">Level</span>
          <Select defaultValue="view" className="mt-1 h-9 text-[13px]" id={`invite-level-${taskId}`}>
            {ACCESS_LEVELS.map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABEL[l]}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <label className="block">
        <span className="hud-label block text-[10.5px]">A line from you (optional)</span>
        <Input className="mt-1 h-9 w-full text-[13px]" id={`invite-note-${taskId}`} />
      </label>

      {isPrivate ? (
        <p className="text-[11.5px] text-warn">
          This task is starred private, so the mail will invite them to the board without quoting
          it. Unstar it first if you want them to see the task.
        </p>
      ) : (
        <p className="text-[11.5px] text-muted">
          The mail is in English and carries this task inside it. They choose their own password and
          land on this board — nothing else in the cockpit.
        </p>
      )}

      {error ? <p className="text-[12px] text-neg">{error}</p> : null}
      {link ? (
        <p className="break-all text-[11.5px] text-muted" dir="ltr">
          {link}
        </p>
      ) : null}
      {said ? <p className="text-[12px] text-pos">{said}</p> : null}

      <div className="flex gap-2">
        <Button type="button" size="xs" variant="outline" onClick={() => setOpen(false)}>
          CLOSE
        </Button>
        <Button
          type="button"
          size="xs"
          disabled={pending}
          onClick={() => {
            const pick = (part: string) =>
              (document.getElementById(`invite-${part}-${taskId}`) as HTMLInputElement | null)
                ?.value ?? '';
            const data = new FormData();
            data.set('email', pick('email'));
            data.set('name', pick('name'));
            data.set('level', pick('level') || 'view');
            data.set('note', pick('note'));
            data.set('taskId', taskId);
            setError(null);
            setSaid(null);
            setLink(null);
            startTransition(async () => {
              const result = await inviteToTasksAction(data);
              if (!result.ok) {
                setError(result.error ?? 'That did not work');
                if (result.link) setLink(result.link);
                return;
              }
              setSaid('Sent. They will land on this board once they set a password.');
              router.refresh();
            });
          }}
        >
          {pending ? 'SENDING…' : 'SEND INVITE'}
        </Button>
      </div>
    </div>
  );
}
