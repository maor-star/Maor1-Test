import { z } from 'zod';
import { todayInTz } from '@/lib/utils';

/**
 * The sales pipeline's vocabulary.
 *
 * Two axes, deliberately separate: what kind of client this is (which side of
 * the business they sit on) and how far along the conversation is. Collapsing
 * them into one field is what makes a CRM stop answering questions.
 */

export const CLIENT_TYPES = [
  'demand',
  'supply',
  // The same partner on both sides — they send us supply and buy demand. It is
  // the arrangement he most wants, and for a while the one kind he could not file.
  'mutual',
  'publisher',
  'seat_lease',
  'vendor',
  'other',
] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const CLIENT_TYPE_LABEL: Record<ClientType, string> = {
  demand: 'DEMAND',
  supply: 'SUPPLY',
  mutual: 'MUTUAL — DEMAND & SUPPLY',
  publisher: 'PUBLISHER',
  seat_lease: 'SEAT LEASE',
  vendor: 'VENDOR',
  other: 'OTHER',
};

/**
 * The six stages a deal moves through, and the one it falls out to.
 *
 * Opportunities and the pipeline used to be two screens with two vocabularies:
 * something he noticed lived in one, and only once somebody had decided it was
 * real did it move to the other. In practice the move never happened, and the
 * first screen filled with things nobody had decided about. So there is one
 * board now, and "open" is its first stage — split by whether the other side
 * is somebody we already work with, because that is the one thing that changes
 * how the conversation is run.
 */
export const STAGES = [
  'open_new',
  'open_existing',
  'negotiation',
  'contract',
  'integration',
  'live',
  'lost',
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  open_new: 'OPEN — NEW CLIENT',
  open_existing: 'OPEN — EXISTING CLIENT',
  negotiation: 'NEGOTIATION',
  contract: 'CONTRACT',
  integration: 'INTEGRATION',
  live: 'LIVE',
  lost: 'LOST',
};

/** Stages where a deal is still moving — the ones that need a next step. */
export const OPEN_STAGES: Stage[] = [
  'open_new',
  'open_existing',
  'negotiation',
  'contract',
  'integration',
];

/**
 * The stages the board used to have, mapped onto the ones it has now.
 *
 * The migration rewrites the rows; this exists for anything that still says
 * the old word — a job on an older build, a URL he bookmarked — so it lands on
 * a real stage rather than on nothing.
 */
export const LEGACY_STAGE: Record<string, Stage> = {
  lead: 'open_new',
  intro: 'open_new',
  qualified: 'open_new',
  contact: 'open_new',
  proposal_sent: 'negotiation',
  contract_out: 'contract',
  dormant: 'open_existing',
};

export function normaliseStage(raw: string | null | undefined): Stage {
  if (raw && (STAGES as readonly string[]).includes(raw)) return raw as Stage;
  return (raw && LEGACY_STAGE[raw]) || 'open_new';
}

export const TEMPERATURES = ['hot', 'warm', 'cold'] as const;
export type Temperature = (typeof TEMPERATURES)[number];

export const TEMPERATURE_LABEL: Record<Temperature, string> = {
  hot: 'HOT',
  warm: 'WARM',
  cold: 'COLD',
};

export const TOUCH_KINDS = ['call', 'meeting', 'email', 'slack', 'note'] as const;
export type TouchKind = (typeof TOUCH_KINDS)[number];

/** How many days without a touch before a client counts as gone quiet. */
export const QUIET_DAYS = 14;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const emptyToNull = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), inner);

/**
 * Every open deal carries a next step and a date for it — but a missing one is
 * filled in rather than refused.
 *
 * The rule (spec §3) is right: a pipeline of deals nobody has committed to
 * move is a list, not a pipeline. Enforcing it by *rejecting the save* turned
 * out to be wrong in practice — he types a name, presses ADD CLIENT, and
 * nothing happens except two lines of small red text. Worse, deals arriving
 * through the mail path were being written without a next step anyway, so the
 * rule only ever bit the person typing by hand.
 *
 * So the invariant is kept and the friction is not: an open deal with no next
 * step is saved with one, dated tomorrow, in words that are plainly a
 * placeholder. It appears in "needs attention" the next morning until he says
 * what the step really is.
 */
export const DEFAULT_NEXT_STEP = 'Decide what happens next';

/** Tomorrow, Israel time — soon enough that an untouched deal surfaces at once. */
export function defaultNextStepDate(today = todayInTz()): string {
  const t = new Date(`${today}T00:00:00Z`);
  return new Date(t.getTime() + 86_400_000).toISOString().slice(0, 10);
}

export const pipelineInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    domain: emptyToNull(z.string().trim().max(200).nullable()).optional(),
    clientType: z.enum(CLIENT_TYPES).default('other'),
    stage: z.preprocess((v) => (typeof v === 'string' ? normaliseStage(v) : v), z.enum(STAGES)).default('open_new'),
    temperature: z.enum(TEMPERATURES).default('warm'),
    ownerPersonId: emptyToNull(z.string().uuid().nullable()).optional(),
    nextStep: emptyToNull(z.string().trim().max(300).nullable()).optional(),
    nextStepDate: emptyToNull(isoDate.nullable()).optional(),
    valueCents: emptyToNull(z.coerce.number().int().min(0).nullable()).optional(),
    probability: emptyToNull(z.coerce.number().int().min(0).max(100).nullable()).optional(),
    source: emptyToNull(z.string().trim().max(120).nullable()).optional(),
    notes: emptyToNull(z.string().trim().max(20_000).nullable()).optional(),
    hubspotCompanyId: emptyToNull(z.string().trim().max(60).nullable()).optional(),
  })
  .transform((v) => {
    if (!OPEN_STAGES.includes(v.stage)) return v;
    return {
      ...v,
      nextStep: v.nextStep || DEFAULT_NEXT_STEP,
      nextStepDate: v.nextStepDate || defaultNextStepDate(),
    };
  });

export type PipelineInput = z.input<typeof pipelineInputSchema>;

export const touchInputSchema = z.object({
  clientId: z.string().uuid(),
  kind: z.enum(TOUCH_KINDS),
  summary: z.string().trim().min(1, 'Say what happened').max(2000),
});
