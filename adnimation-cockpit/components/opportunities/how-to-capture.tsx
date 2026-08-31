import { Num } from '@/components/num';

/**
 * How things get in here, said plainly on the screen.
 *
 * The first version of this module had three capture paths and none of them
 * were used: two lived inside the cockpit, which is not where he reads mail or
 * Slack, and the third needed Slack app configuration he had not done. Capture
 * only happens where he already is, and only if he knows what to do without
 * being told again — so the instructions live on the page rather than in a
 * message he has to remember.
 */
export function HowToCapture({ gmailLabels }: { gmailLabels: string[] }) {
  return (
    <div className="border border-divider p-4">
      <p className="hud-label mb-3 text-[9px]">THREE WAYS IN — ALL FROM WHERE YOU ALREADY ARE</p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Step
          num="01"
          title="In Gmail"
          body={
            <>
              Apply the label{' '}
              {gmailLabels.map((l, i) => (
                <span key={l}>
                  {i > 0 ? ' or ' : ''}
                  <span className="font-semi text-accent-700">{l}</span>
                </span>
              ))}{' '}
              to any conversation. It appears here within the hour, with the thread linked. Create
              the label once in Gmail; after that it is one click while you read — including on
              conversations you have already replied to.
            </>
          }
        />
        <Step
          num="02"
          title="In Slack"
          body={
            <>
              Send it to the <span className="font-semi text-accent-700">cockpit bot</span> in a
              DM — forward a message to it, or just type a line. Anything you send it becomes an
              opportunity, and it replies to confirm. Nothing to set up.
            </>
          }
        />
        <Step
          num="03"
          title="Here"
          body={
            <>
              “Write one down” for anything that is only in your head. A title alone is enough —
              it will show as needing a next step until you give it one.
            </>
          }
        />
      </div>

      <p className="mt-3 border-t border-divider pt-2 font-semi text-[10px] tracking-[0.1em] text-neutral-500">
        MAIL IS ALSO READ HOURLY FOR CANDIDATES — THOSE ARRIVE UNDER “SUGGESTED” AND WAIT FOR YOUR
        YES OR NO. WHEN ONE BECOMES A REAL DEAL, “<Num>→</Num> PIPELINE” MOVES IT ACROSS.
      </p>
    </div>
  );
}

function Step({ num, title, body }: { num: string; title: string; body: React.ReactNode }) {
  return (
    <div>
      <p className="hud-label text-[9px] text-accent-700">
        <Num>{num}</Num> · {title.toUpperCase()}
      </p>
      <p className="mt-1 text-[13px] leading-snug text-neutral-600">{body}</p>
    </div>
  );
}
