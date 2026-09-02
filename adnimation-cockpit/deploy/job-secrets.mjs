/**
 * The credentials a job can use, environment first, then the ones he set in
 * the app.
 *
 * The jobs run outside the compiled app and read process.env, which was fine
 * while every key arrived by deploy. Now he can paste one into the Keys screen
 * — and a key that reaches the app but not the job that needs it is worse than
 * no key at all, because the screen says it is set.
 *
 * Encryption matches lib/secrets/store.ts exactly: AES-256-GCM under a key
 * derived from AUTH_SECRET, which is in the instance's .env and not in the
 * database. A value that will not decrypt is treated as absent rather than
 * throwing inside whatever was about to use it.
 */
import { createDecipheriv, createHash } from 'node:crypto';

function keyFor(authSecret) {
  return createHash('sha256').update(`cockpit-secrets:${authSecret}`).digest();
}

export function decrypt(stored, authSecret) {
  try {
    const [iv, tag, body] = String(stored).split(':');
    if (!iv || !tag || !body) return null;
    const decipher = createDecipheriv('aes-256-gcm', keyFor(authSecret), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Fill in the named variables on process.env from the app's store, leaving
 * anything the environment already has exactly as it is.
 *
 * Returns which names it filled, for the job's log — the names only, never a
 * value or its length.
 */
export async function loadSecrets(sql, names) {
  const authSecret = process.env.AUTH_SECRET;
  const wanted = names.filter((n) => !process.env[n]);
  if (wanted.length === 0 || !authSecret) return [];

  const rows = await sql`
    select key, value_enc from app_secrets where key = any(${wanted}::text[])
  `.catch(() => []);

  const filled = [];
  for (const row of rows) {
    const value = decrypt(row.value_enc, authSecret);
    if (!value) continue;
    process.env[row.key] = value;
    filled.push(row.key);
  }
  return filled;
}
