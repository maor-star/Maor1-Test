import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { agents, db } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Figure } from '@/components/hud/figure';
import { DraftCard } from '@/components/marketing/draft-card';
import { WriteNow } from '@/components/marketing/write-now';
import { AGENT_NAME, draftCounts, linkedInReady, listDrafts } from '@/lib/marketing/service';

export const dynamic = 'force-dynamic';

/**
 * The marketing screen — the posts written in his name, before they are his.
 *
 * The agent finds what went right (a contract signed, a deal live, an
 * achievement in his mail) and writes the post. This is where he reads it,
 * changes the half he does not like, and publishes it — or declines it, which
 * is the most useful thing he can do, because the next draft is written with
 * the declined ones in front of it.
 *
 * Publishing happens here and nowhere else. There is no agent action, no
 * autonomy level and no dial that puts a post on LinkedIn without this click.
 */
export default async function MarketingPage() {
  await requireUser();

  const [drafts, counts, linkedIn, [agent]] = await Promise.all([
    listDrafts(),
    draftCounts(),
    linkedInReady(),
    db.select().from(agents).where(eq(agents.name, AGENT_NAME)).limit(1),
  ]);

  const waiting = drafts.filter((d) => d.status === 'draft');
  const decided = drafts.filter((d) => d.status !== 'draft');

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="MARKETING / 12"
        title="Posts"
        action={
          <span className="font-semi text-[11.5px] tracking-[0.14em] text-neutral-500">
            <Link href="/agents?q=marketing-writer" className="text-info hover:underline">
              MARKETING-WRITER {agent?.enabled ? 'ON' : 'OFF'}
            </Link>
            {' · '}
            {linkedIn.ready ? 'LINKEDIN CONNECTED' : 'LINKEDIN NOT CONNECTED'}
          </span>
        }
      />

      <HudCard>
        <div className="grid grid-cols-3 gap-x-8 gap-y-4">
          <Figure label="WAITING FOR YOU" value={counts.waiting} big tone={counts.waiting > 0 ? 'warn' : undefined} />
          <Figure label="PUBLISHED" value={counts.posted} />
          <Figure label="DECLINED" value={counts.declined} />
        </div>
        <div className="border-t border-line pt-3">
          <WriteNow />
        </div>
        <p className="font-semi text-[11.5px] leading-relaxed tracking-[0.12em] text-neutral-500">
          NOTHING HERE GOES OUT UNTIL YOU PRESS PUBLISH. THE AGENT WRITES; PUBLISHING IS YOURS.
          {linkedIn.ready ? null : (
            <>
              {' '}
              LINKEDIN Is not connected —{' '}
              <Link href="/settings" className="text-info hover:underline">
                SET {linkedIn.missing.join(' AND ')} ON KEYS
              </Link>
              . Until then, copy the text and post it yourself.
            </>
          )}
        </p>
      </HudCard>

      <HudCard className="gap-0 p-0">
        <div className="p-[18px] pb-3">
          <HudCardHeader title="Waiting for you" index="M01" />
        </div>
        {waiting.length === 0 ? (
          <p className="border-t border-line px-[18px] py-4 font-semi text-[12px] text-neutral-500">
            Nothing waiting. Press “Write what is worth posting” above, or switch the marketing-writer
            agent on and it writes every Sunday morning.
          </p>
        ) : (
          <ul>
            {waiting.map((d) => (
              <DraftCard key={d.id} draft={d} canPublish={linkedIn.ready} missing={linkedIn.missing} />
            ))}
          </ul>
        )}
      </HudCard>

      {decided.length > 0 ? (
        <HudCard className="gap-0 p-0">
          <div className="p-[18px] pb-3">
            <HudCardHeader title="Already decided" index="M02" />
          </div>
          <ul>
            {decided.map((d) => (
              <DraftCard key={d.id} draft={d} canPublish={linkedIn.ready} missing={linkedIn.missing} />
            ))}
          </ul>
        </HudCard>
      ) : null}
    </div>
  );
}
