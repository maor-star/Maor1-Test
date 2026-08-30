import { z } from 'zod';

/**
 * What the CRM accepts, with no database underneath.
 *
 * Kept apart from the writes so the rules can be tested directly: an empty
 * field means "not set" rather than the empty string, a category the portal
 * invented is preserved rather than dropped, and a record created here is
 * identifiable by its id alone.
 */

export const LOCAL_ID_PREFIX = 'local:';

export const isLocalId = (id: string) => id.startsWith(LOCAL_ID_PREFIX);

const text = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max).nullable(),
  );

export const companyInputSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  name: z.string().trim().min(1, 'A company needs a name').max(300),
  domain: text(300).optional(),
  lifecycleStage: text(80).optional(),
  ownerName: text(200).optional(),
  industry: text(120).optional(),
  country: text(120).optional(),
  city: text(120).optional(),
  phone: text(60).optional(),
  notes: text(20_000).optional(),
});

export const contactInputSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  firstName: text(120).optional(),
  lastName: text(120).optional(),
  email: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().email('That is not an email address').max(200).nullable(),
  ).optional(),
  phone: text(60).optional(),
  jobTitle: text(200).optional(),
  companyId: text(80).optional(),
  companyName: text(300).optional(),
  lifecycleStage: text(80).optional(),
  ownerName: text(200).optional(),
  notes: text(20_000).optional(),
}).refine(
  (v) => Boolean(v.firstName || v.lastName || v.email),
  { message: 'A contact needs a name or an email', path: ['firstName'] },
);

export type CompanyInput = z.input<typeof companyInputSchema>;
export type ContactInput = z.input<typeof contactInputSchema>;

