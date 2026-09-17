import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Num } from '@/components/num';
import { PillarEditor } from '@/components/settings/pillar-editor';
import { allPillars } from '@/lib/control/pillar-store';
import { workPerLine } from '@/lib/control/tagging';

export const dynamic = 'force-dynamic';

/**
 * The pillar list, edited.
 *
 * The chips across the top of Tasks, Pipeline and Contracts were seven names
 * compiled into the app: renaming one was a deploy and adding one was not
 * possible. This is where that list lives now.
 *
 * Owner only — a pillar is the company's taxonomy, read by every board, every
 * tag and every target, and the people granted the tasks board have no
 * business rewriting it.
 */
export default async function PillarsPage() {
  await requireOwner();
  const [pillars, work] = await Promise.all([allPillars(), workPerLine()]);

  const rows = pillars.map((p) => {
    const counts = work.get(p.line) ?? { task: 0, deal: 0, contract: 0 };
    return { ...p, tagged: counts.task + counts.deal + counts.contract };
  });

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="SETTINGS"
        title="Pillars"
        action={
          <Link href="/settings" className="text-2xs text-muted-foreground hover:underline">
            KEYS →
          </Link>
        }
      />

      <HudCard>
        <p className="text-[13px] leading-relaxed text-neutral-700">
          These are the chips across the top of Tasks, Pipeline and Contracts, and the tags on
          every task, deal and contract. Rename one and it changes everywhere at once — the key
          underneath never moves, so nothing already tagged is lost. Hiding one takes it off the
          boards and keeps every tag on the work carrying it; switch it back on and they return.
          Nothing here deletes anything.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-neutral-700">
          A pillar you add is a real pillar everywhere work is tagged and filtered. It gets{' '}
          <strong>no tile on the overview</strong>: those read the revenue sync, and the sync
          reports against the <Num>7</Num> engines it knows. A tile with nothing behind it would
          show a permanent zero, which on that screen reads as a line that collapsed.
        </p>
      </HudCard>

      <HudCard className="gap-0 p-0">
        <div className="p-[18px] pb-3">
          <HudCardHeader title="The list" index="S05" />
        </div>
        <PillarEditor pillars={rows} />
      </HudCard>
    </div>
  );
}
