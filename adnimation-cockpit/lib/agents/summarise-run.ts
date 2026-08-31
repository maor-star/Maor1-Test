/**
 * The one line that says how a run went, without opening it.
 *
 * Lives apart from the rest of the learning module because the card is a
 * client component: importing this must not drag the database in with it.
 */
export interface RunSummaryLike {
  dry: boolean;
  summary: Record<string, unknown>;
}

export function summarise(run: RunSummaryLike): string {
  const s = run.summary;
  if (typeof s.skipped === 'string') return s.skipped;

  const parts: string[] = [];
  const say = (key: string, label: string) => {
    const n = s[key];
    if (typeof n === 'number' && n > 0) parts.push(`${n} ${label}`);
  };
  say('read', 'read');
  say('answered', run.dry ? 'would be answered' : 'answered');
  say('filed', 'filed without a reply');
  say('left', 'left for you');
  say('found', 'looked like invoices');
  say('sent', run.dry ? 'would be forwarded' : 'forwarded');
  say('trashed', 'spent codes cleared');
  say('held', 'held back by your brief');

  return parts.join(' · ') || 'nothing to report';
}
