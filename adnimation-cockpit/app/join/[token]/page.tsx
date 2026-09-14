import { openInvite } from '@/lib/tasks/invite-service';
import { JoinForm } from '@/components/join-form';

/**
 * Taking up an invitation.
 *
 * The one page in the cockpit a stranger is meant to reach. It is public
 * because it has to be — the person has no account yet, which is the whole
 * point — and the token in the URL is the entire authorisation.
 *
 * It shows nothing until that token resolves, and every way of being invalid
 * gets the same answer: expired, already used, revoked, never existed. Telling
 * them which would turn the URL into a way to find out who has been invited.
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await openInvite(token).catch(() => null);

  return (
    <main className="hud-ground flex min-h-dvh items-center justify-center p-6" dir="ltr">
      <div className="hud-card hud-marks w-full max-w-md p-8">
        <div className="font-cond text-[25px] font-semibold leading-none tracking-[0.2em] text-neutral-900">
          Adnimation
        </div>
        <div className="mt-2 hud-kicker">TASK BOARD</div>

        {invite === null ? (
          <div className="mt-6 space-y-2">
            <p className="text-[15px] font-semibold text-ink">This invitation is not valid.</p>
            <p className="text-[13.5px] text-muted">
              It may have expired, or already been used. Ask whoever invited you to send a new one.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-6 space-y-1.5">
              <p className="text-[15px] text-ink">
                <span className="font-semibold">{invite.invitedByName}</span> invited you to the
                Adnimation task board.
              </p>
              {invite.taskTitle ? (
                <p className="rounded-[8px] border border-line bg-neutral-50 px-3 py-2 text-[13.5px] text-ink">
                  <span className="hud-label block text-[10.5px]">The task</span>
                  {invite.taskTitle}
                </p>
              ) : null}
              <p className="text-[13px] text-muted">
                You will see {invite.level === 'edit' ? 'and update ' : ''}the tasks on that board —
                and nothing else in the system.
              </p>
            </div>

            <JoinForm
              token={token}
              email={invite.email}
              name={invite.name}
              returning={invite.alreadyHasLogin}
            />
          </>
        )}
      </div>
    </main>
  );
}
