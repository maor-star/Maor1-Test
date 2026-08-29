import { z } from 'zod';

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
  'publisher',
  'seat_lease',
  'vendor',
  'other',
] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const CLIENT_TYPE_LABEL: Record<ClientType, string> = {
  demand: 'DEMAND',
  supply: 'SUPPLY',
  publisher: 'PUBLISHER',
  seat_lease: 'SEAT LEASE',
  vendor: 'VENDOR',
  other: 'OTHER',
};

/** Spec §3 — the eight stages plus the two terminal ones. */
export const STAGES = [
  'lead',
  'intro',
  'qualified',
  'negotiation',
  'proposal_sent',
  'contract_out',
  'integration',
  'live',
  'dormant',
  'lost',
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  lead: 'LEAD',
  intro: 'INTRO',
  qualified: 'QUALIFIED',
  negotiation: 'NEGOTIATION',
  proposal_sent: 'PROPOSAL SENT',
  contract_out: 'CONTRACT OUT',
  integration: 'INTEGRATION',
  live: 'LIVE',
  dormant: 'DORMANT',
  lost: 'LOST',
};

/** Stages where a deal is still moving — the ones that need a next step. */
export const OPEN_STAGES: Stage[] = [
  'lead',
  'intro',
  'qualified',
  'negotiation',
  'proposal_sent',
  'contract_out',
  'integration',
];

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
 * Spec §3 is explicit: a deal in an open stage cannot be saved without a next
 * step and a date for it, and the rule is enforced on the server rather than
 * only in the form. A pipeline of deals nobody has committed to move is a list,
 * not a pipeline.
 */
export const pipelineInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    domain: emptyToNull(z.string().trim().max(200).nullable()).optional(),
    clientType: z.enum(CLIENT_TYPES).default('other'),
    stage: z.enum(STAGES).default('lead'),
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
  .superRefine((v, ctx) => {
    if (!OPEN_STAGES.includes(v.stage)) return;
    if (!v.nextStep) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nextStep'],
        message: 'An open deal needs a next step.',
      });
    }
    if (!v.nextStepDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nextStepDate'],
        message: 'An open deal needs a date for its next step.',
      });
    }
  });

export type PipelineInput = z.input<typeof pipelineInputSchema>;

export const touchInputSchema = z.object({
  clientId: z.string().uuid(),
  kind: z.enum(TOUCH_KINDS),
  summary: z.string().trim().min(1, 'Say what happened').max(2000),
});
