import { requireOwner } from '@/lib/auth/session';
import { HudCard, HudCardHeader } from '@/components/hud/card';
import { PageHeader } from '@/components/hud/page-header';
import { Num } from '@/components/num';
import { SecretField } from '@/components/settings/secret-field';
import { GROUP_LABEL, SECRETS, SECRET_KEYS } from '@/lib/secrets/catalogue';
import { statusOf } from '@/lib/secrets/store';

export const dynamic = 'force-dynamic';

/**
 * The keys, set from here rather than from a deploy.
 *
 * Everything the app needed before it existed lives in the instance's .env and
 * gets there without passing through a log. That is right for those. It is
 * wrong for the keys he acquires while using the thing — a LinkedIn token, a
 * Lovable key — where waiting for someone with AWS access is not a workflow.
 *
 * A value pasted here is encrypted under a key that is not in this database
 * and never comes back to a browser. What comes back is whether it is set,
 * when, and its last four characters.
 */
export default async function SettingsPage() {
  await requireOwner();
  const statuses = await statusOf(SECRET_KEYS);
  const byKey = new Map(statuses.map((s) => [s.key, s]));
  const missing = statuses.filter((s) => !s.set).length;

  const groups = (['data', 'models', 'scheduling', 'publishing'] as const).map((group) => ({
    group,
    specs: SECRETS.filter((s) => s.group === group),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="SETTINGS"
        title="Keys"
        action={
          <span className="font-semi text-[10px] tracking-[0.14em] text-neutral-500">
            {missing === 0 ? (
              'EVERYTHING IS SET'
            ) : (
              <>
                <Num>{missing}</Num> NOT SET YET
              </>
            )}
          </span>
        }
      />

      <HudCard>
        <p className="text-[13px] leading-relaxed text-neutral-700">
          A key pasted here is encrypted with a key that is not in this database, and never comes
          back to this screen — you will see that it is set, when, and its last four characters.
          It takes effect on the next run, with no deploy. A key already set on the server by a
          deploy wins over anything here and cannot be replaced from a browser.
        </p>
      </HudCard>

      {groups.map(({ group, specs }) => (
        <HudCard key={group} className="gap-0 p-0">
          <div className="p-[18px] pb-3">
            <HudCardHeader
              title={GROUP_LABEL[group]}
              index={
                group === 'data' ? 'S01' : group === 'models' ? 'S02' : group === 'scheduling' ? 'S03' : 'S04'
              }
            />
          </div>
          <ul>
            {specs.map((spec) => (
              <SecretField key={spec.key} spec={spec} status={byKey.get(spec.key)!} />
            ))}
          </ul>
        </HudCard>
      ))}
    </div>
  );
}
