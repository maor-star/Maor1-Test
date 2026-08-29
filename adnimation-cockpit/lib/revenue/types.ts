import { z } from 'zod';

/**
 * Revenue comes from the Ad Ops Architect system (spec question 21.1, answered:
 * the ARS tables in that project's PostgreSQL). One row per day per demand
 * category per business line.
 */

export const ARS_CATEGORIES = [
  'google', 'header_bidding', 'video', 'content_recommendations', 'ebda',
] as const;
export type ArsCategory = (typeof ARS_CATEGORIES)[number];

/** How the source labels the account: trading desk vs. managed publisher. */
export type BusinessLine = 'trading' | 'publisher';

export const CATEGORY_LABEL: Record<string, string> = {
  google: 'Google (GAM)',
  header_bidding: 'Header Bidding',
  video: 'Video',
  content_recommendations: 'Content Recommendations',
  ebda: 'EBDA',
};

export const arsRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().min(1),
  trading: z.boolean(),
  grossCents: z.number().int(),
  feeCents: z.number().int(),
  impressions: z.number().int().nonnegative(),
});

export type ArsRow = z.infer<typeof arsRowSchema>;

/** A row after fees are applied and a department is assigned. */
export interface RevenueFact {
  date: string;
  /** The source's own demand category — see lib/revenue/departments.ts. */
  deptCode: string;
  category: string;
  businessLine: BusinessLine;
  grossCents: number;
  feeCents: number;
  netCents: number;
  impressions: number;
}
