import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { appSecrets, db } from '@/lib/db';
import { writeAudit } from '@/lib/audit';

/**
 * The keys he sets himself.
 *
 * Everything the app needed before it existed — the database, the auth secret,
 * the Google service account — lives in the instance's .env and gets there
 * through deploy/set-secret.mjs, which never puts a value in a command log.
 * That is right for those. It is wrong for the keys he acquires while using
 * the thing: a LinkedIn token, a Lovable key, whatever is next. Waiting for
 * someone with AWS access is not a workflow.
 *
 * So these live in the database, encrypted with AES-256-GCM under a key
 * derived from AUTH_SECRET — which is not in this table and not in this
 * database. A dump of the table is not a set of credentials.
 *
 * Three rules hold everywhere below:
 *  · a value never travels back to a browser — the screen gets set/not set,
 *    when, and the last four characters, which is enough to tell two keys
 *    apart and not enough to use one;
 *  · a value is never logged, never audited, never in an error message;
 *  · the environment still wins where it is set, so nothing he pastes can
 *    quietly replace a key the deploy put there on purpose.
 */

const ALGO = 'aes-256-gcm';

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set, so secrets cannot be encrypted');
  // A 32-byte key from whatever length AUTH_SECRET happens to be.
  return createHash('sha256').update(`cockpit-secrets:${secret}`).digest();
}

export function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

export function decrypt(stored: string): string | null {
  try {
    const [ivB64, tagB64, bodyB64] = stored.split(':');
    if (!ivB64 || !tagB64 || !bodyB64) return null;
    const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(bodyB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    // A value that will not decrypt is a value we do not have. Saying so
    // beats throwing inside whatever was trying to use it.
    return null;
  }
}

/** The last four characters, which is how he tells two keys apart. */
export const hintOf = (value: string): string =>
  value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;

const cache = new Map<string, { value: string | null; at: number }>();
const CACHE_MS = 30_000;

/**
 * One credential, environment first.
 *
 * The environment wins so that a key the deploy set on purpose cannot be
 * quietly replaced from a browser — and so that removing a pasted key falls
 * back to the deploy's rather than to nothing.
 */
export async function secret(name: string): Promise<string | null> {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;

  const held = cache.get(name);
  if (held && Date.now() - held.at < CACHE_MS) return held.value;

  const [row] = await db.select().from(appSecrets).where(eq(appSecrets.key, name)).limit(1);
  const value = row ? decrypt(row.valueEnc) : null;
  cache.set(name, { value, at: Date.now() });
  return value;
}

export interface SecretStatus {
  key: string;
  set: boolean;
  /** Where it came from: the deploy's environment, or the app. */
  from: 'environment' | 'app' | null;
  hint: string | null;
  updatedAt: Date | null;
}

export async function statusOf(names: string[]): Promise<SecretStatus[]> {
  const rows = await db.select().from(appSecrets);
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return names.map((name) => {
    if (process.env[name]) {
      return { key: name, set: true, from: 'environment' as const, hint: null, updatedAt: null };
    }
    const row = byKey.get(name);
    return {
      key: name,
      set: Boolean(row),
      from: row ? ('app' as const) : null,
      hint: row?.hint ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

/**
 * Store one, or clear it.
 *
 * The audit row records that a key changed and who changed it. It records
 * nothing of the value — not even its length, which for some tokens is enough
 * to say which service it belongs to.
 */
export async function setSecret(name: string, value: string | null, actor: string): Promise<void> {
  const trimmed = (value ?? '').trim();

  if (!trimmed) {
    await db.delete(appSecrets).where(eq(appSecrets.key, name));
    cache.delete(name);
    await writeAudit({ actor, action: 'secret.clear', entityType: 'secret', entityId: name });
    return;
  }

  const row = { key: name, valueEnc: encrypt(trimmed), hint: hintOf(trimmed), updatedAt: new Date(), updatedBy: actor };
  await db
    .insert(appSecrets)
    .values(row)
    .onConflictDoUpdate({ target: appSecrets.key, set: row });
  cache.delete(name);
  await writeAudit({ actor, action: 'secret.set', entityType: 'secret', entityId: name });
}
