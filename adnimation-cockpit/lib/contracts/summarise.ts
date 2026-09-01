import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { contractVersions, contracts, db } from '@/lib/db';
import { fetchForReading } from '@/lib/integrations/drive';
import { ask } from '@/lib/integrations/claude';

/**
 * What a contract actually says, without reading twenty pages.
 *
 * The point is not a précis — it is the handful of things that decide whether
 * he signs: what we owe, what they owe, what it costs, how long it runs, how
 * it ends, and anything that would be unusual to agree to. A summary that
 * reads nicely and omits the auto-renewal is worse than none, so the shape is
 * fixed and the model fills it in rather than choosing what to mention.
 *
 * It reads. It never edits, signs or sends anything.
 */

export const summarySchema = z.object({
  whatItIs: z.string(),
  parties: z.string(),
  weProvide: z.array(z.string()),
  theyProvide: z.array(z.string()),
  commercials: z.array(z.string()),
  term: z.string(),
  termination: z.string(),
  /** The clauses worth arguing about before signing. */
  watchOut: z.array(z.object({ clause: z.string(), why: z.string() })),
  /** Anything the document leaves open. */
  missing: z.array(z.string()),
});

export type ContractSummary = z.infer<typeof summarySchema>;

const SYSTEM = `You are reading a commercial contract for the CEO of Adnimation,
an Israeli ad-tech company that both buys demand and sells supply.

Report only what the document says. Where it is silent on something that
matters, say so under "missing" rather than filling the gap with what is usual.
Quote figures, percentages, notice periods and dates exactly as written — a
rounded number in a summary of a contract is a wrong number.

"watchOut" is for terms that are unusual, one-sided, or expensive to discover
later: automatic renewal, exclusivity, uncapped liability, unilateral changes to
rates, long notice periods, non-compete, IP assignment, personal guarantees,
governing law far from Israel. If there are none, return an empty list rather
than inventing concerns.

You are not giving legal advice and not deciding anything. You are telling him
what he is about to sign.`;

const PROMPT = `Summarise this contract as JSON matching exactly this shape:

{
  "whatItIs": "one sentence — the kind of agreement and its purpose",
  "parties": "who is contracting with whom",
  "weProvide": ["Adnimation's obligations"],
  "theyProvide": ["the counterparty's obligations"],
  "commercials": ["rates, revenue shares, minimums, payment terms — exact figures"],
  "term": "start, length, and any renewal",
  "termination": "how either side gets out, and the notice required",
  "watchOut": [{ "clause": "the term", "why": "why it matters to him" }],
  "missing": ["anything important the document does not settle"]
}

Return only the JSON.`;

export interface SummaryResult {
  ok: boolean;
  summary?: ContractSummary;
  error?: string;
  needsKey?: boolean;
  /** Which version was read, so a summary is never mistaken for a newer one. */
  versionNo?: number;
  fileName?: string;
  versionId?: string;
}

/**
 * Summarise one contract — by default its newest version, or a named one.
 *
 * A "contract" here is often several documents: the agreement, an addendum, a
 * revised draft that came back a week later. Summarising only the newest was
 * right for "what am I about to sign" and useless for "what changed", and for
 * the case he actually hits — three files arriving at once, none of which he
 * has read. So every version can be read on its own, and the result says which
 * one it was.
 */
export async function summariseContract(
  contractId: string,
  versionId?: string,
): Promise<SummaryResult> {
  const [contract] = await db
    .select()
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);
  if (!contract) return { ok: false, error: 'No such contract' };

  const versions = await db
    .select()
    .from(contractVersions)
    .where(eq(contractVersions.contractId, contractId));

  const readable = versions.filter((v) => v.driveFileId);

  // Named: exactly that document. Unnamed: the newest, because summarising v1
  // of a contract now on v3 describes terms already renegotiated.
  const latest = versionId
    ? readable.find((v) => v.id === versionId)
    : readable.sort((a, b) => b.versionNo - a.versionNo)[0];

  if (!latest?.driveFileId) {
    return {
      ok: false,
      error: versionId
        ? 'That document is not in Drive'
        : 'No version of this contract is in Drive yet',
    };
  }

  const file = await fetchForReading(latest.driveFileId);
  if (!file.ok) return { ok: false, error: file.error };

  const result =
    file.kind === 'pdf'
      ? await ask<ContractSummary>(PROMPT, {
          system: SYSTEM,
          document: { base64: file.base64, mediaType: 'application/pdf' },
          schema: summarySchema,
          maxTokens: 3000,
        })
      : await ask<ContractSummary>(
          // A very long document costs tokens and adds nothing past the
          // operative clauses; the schedules are rarely where the trap is.
          `${PROMPT}\n\nThe contract:\n\n${file.text.slice(0, 180_000)}`,
          { system: SYSTEM, schema: summarySchema, maxTokens: 3000 },
        );

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      ...(result.needsKey ? { needsKey: true } : {}),
    };
  }
  if (!result.parsed) return { ok: false, error: 'Claude did not return a summary' };

  return {
    ok: true,
    summary: result.parsed,
    versionNo: latest.versionNo,
    fileName: latest.fileName,
    versionId: latest.id,
  };
}
