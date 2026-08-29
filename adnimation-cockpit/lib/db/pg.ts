// Thin re-export layer over drizzle's pg-core so every table declares
// timestamps as `timestamptz` (CLAUDE.md §10: all timestamps stored UTC).
import { bigint as bigintCol, timestamp } from 'drizzle-orm/pg-core';

export {
  bigserial, boolean, date, index, integer, jsonb, numeric, pgTable,
  primaryKey, smallint, text, uuid,
} from 'drizzle-orm/pg-core';

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// Money is stored in minor units (cents) as BIGINT — never floats (CLAUDE.md §10).
// `mode: 'number'` is safe here: 2^53 cents is ~$90 trillion, far above any
// figure this system handles, and it keeps arithmetic in the app ergonomic.
export const moneyCents = (name: string) => bigintCol(name, { mode: 'number' });
