import { createSign } from 'node:crypto';
import { z } from 'zod';

/**
 * Google Drive, for filing contracts.
 *
 * Its own token for its own scope, for the same reason the mail sender has
 * one: domain-wide delegation fails the whole token request when a scope has
 * not been granted, so sharing a token would mean an ungranted Drive scope
 * breaking Gmail. Here it means Drive can be unauthorised and everything else
 * carries on — the contract still gets a row, a version, a hash and a link
 * back to where it came from, and only the file bytes wait.
 *
 * Nothing here deletes or overwrites. Filing a new version adds a file;
 * changing a status moves one. Drive keeps a file's id across a move, so a
 * link already shared stays valid.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const serviceAccountSchema = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
});

const base64url = (input: string | Buffer) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export interface DriveStatus {
  configured: boolean;
  authorised: boolean;
  reason?: string;
}

export interface UploadResult {
  ok: boolean;
  fileId?: string;
  webViewLink?: string;
  error?: string;
  /** True when the only thing missing is the Drive scope. */
  needsScope?: boolean;
}

function credentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const mailbox = process.env.GMAIL_MAILBOX;
  if (!raw || !mailbox) return null;
  try {
    const parsed = serviceAccountSchema.safeParse(
      JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')),
    );
    return parsed.success ? { key: parsed.data, mailbox } : null;
  } catch {
    return null;
  }
}

let cached: { value: string; expiresAt: number } | null = null;

async function token(): Promise<{ token: string } | { error: string; needsScope: boolean }> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return { token: cached.value };

  const creds = credentials();
  if (!creds) return { error: 'Drive is not configured on the server', needsScope: false };

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: creds.key.client_email,
      sub: creds.mailbox,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${base64url(
    signer.sign(creds.key.private_key.replace(/\\n/g, '\n')),
  )}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const body = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error?: string; error_description?: string }
    | null;

  if (!body?.access_token) {
    const unauthorised =
      body?.error === 'unauthorized_client' ||
      (body?.error_description ?? '').toLowerCase().includes('not authorized');
    return {
      error: unauthorised
        ? 'Drive is not authorised yet — add https://www.googleapis.com/auth/drive to the ' +
          'service account under domain-wide delegation.'
        : `Drive auth failed: ${body?.error_description ?? `http_${res.status}`}`,
      needsScope: unauthorised,
    };
  }

  cached = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return { token: cached.value };
}

export async function driveStatus(): Promise<DriveStatus> {
  if (!credentials()) return { configured: false, authorised: false, reason: 'No service account' };
  const auth = await token();
  return 'error' in auth
    ? { configured: true, authorised: false, reason: auth.error }
    : { configured: true, authorised: true };
}

async function api(path: string, init: RequestInit = {}, auth?: string) {
  const bearer = auth ?? (await token());
  const value = typeof bearer === 'string' ? bearer : 'token' in bearer ? bearer.token : null;
  if (!value) throw new Error('no Drive token');

  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${value}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`drive ${path}: http_${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Drive queries take the name in single quotes, so an apostrophe must escape. */
const escapeName = (name: string) => name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/**
 * Resolve a folder path, creating whatever is missing.
 *
 * Idempotent by design: two contracts arriving at once for the same
 * counterparty must not produce two folders of the same name, so each level
 * looks before it creates.
 */
export async function ensureFolderPath(
  segments: string[],
  rootId = process.env.DRIVE_CONTRACTS_ROOT_ID,
): Promise<{ ok: true; folderId: string } | { ok: false; error: string; needsScope?: boolean }> {
  const auth = await token();
  if ('error' in auth) return { ok: false, error: auth.error, needsScope: auth.needsScope };

  // With no configured root the first segment is created in My Drive, which is
  // where a service account's own Drive is — usable, but he would never find
  // it. Better to say so.
  let parent = rootId ?? null;
  if (!parent) {
    return {
      ok: false,
      error: 'DRIVE_CONTRACTS_ROOT_ID is not set — nothing knows which folder to file into.',
    };
  }

  for (const segment of segments) {
    const q = [
      `name = '${escapeName(segment)}'`,
      `mimeType = '${FOLDER_MIME}'`,
      `'${parent}' in parents`,
      'trashed = false',
    ].join(' and ');

    const found = (await api(
      `/files?q=${encodeURIComponent(q)}&fields=files(id,name)` +
        '&supportsAllDrives=true&includeItemsFromAllDrives=true',
      {},
      auth.token,
    )) as { files?: { id: string }[] };

    const existing = found.files?.[0]?.id;
    if (existing) {
      parent = existing;
      continue;
    }

    const created = (await api(
      '/files?fields=id&supportsAllDrives=true',
      {
        method: 'POST',
        body: JSON.stringify({ name: segment, mimeType: FOLDER_MIME, parents: [parent] }),
      },
      auth.token,
    )) as { id: string };
    parent = created.id;
  }

  return { ok: true, folderId: parent };
}

/** Upload one version. Never overwrites — a new version is a new file. */
export async function uploadFile(opts: {
  folderId: string;
  name: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<UploadResult> {
  const auth = await token();
  if ('error' in auth) return { ok: false, error: auth.error, needsScope: auth.needsScope };

  const boundary = `cockpit${Date.now()}`;
  const metadata = JSON.stringify({ name: opts.name, parents: [opts.folderId] });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${opts.mimeType}\r\n\r\n`,
    ),
    opts.bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    `${UPLOAD}/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: body as unknown as BodyInit,
    },
  );

  if (!res.ok) {
    return { ok: false, error: `Drive refused the upload: http_${res.status} ${(await res.text()).slice(0, 200)}` };
  }

  const created = (await res.json()) as { id: string; webViewLink?: string };
  return {
    ok: true,
    fileId: created.id,
    ...(created.webViewLink ? { webViewLink: created.webViewLink } : {}),
  };
}

/**
 * Remove folders left empty after a file moved out.
 *
 * Classifying a contract moves its versions from `_Unclassified/<Counterparty>`
 * into the real category, and the folder it left behind stays for ever unless
 * something clears it. Walking up from the deepest segment means the
 * counterparty folder goes, and then its parent if that is now empty too.
 *
 * It trashes rather than deletes. An empty folder is not data, but Drive's
 * delete is permanent and its trash is not — and a folder that turns out to
 * have mattered is then still recoverable, which costs nothing.
 *
 * Three things it will not do: touch the root, touch a folder holding
 * anything at all, or walk outside the path it was given.
 */
export async function pruneEmptyFolders(
  segments: string[],
  rootId = process.env.DRIVE_CONTRACTS_ROOT_ID,
): Promise<{ trashed: string[]; error?: string }> {
  const auth = await token();
  if ('error' in auth) return { trashed: [], error: auth.error };
  if (!rootId) return { trashed: [], error: 'no Drive root configured' };

  const trashed: string[] = [];

  // Resolve the chain first, so each level knows its own id and its parent's.
  const chain: { id: string; name: string }[] = [];
  let parent = rootId;
  for (const segment of segments) {
    const q = [
      `name = '${escapeName(segment)}'`,
      `mimeType = '${FOLDER_MIME}'`,
      `'${parent}' in parents`,
      'trashed = false',
    ].join(' and ');
    const found = (await api(
      `/files?q=${encodeURIComponent(q)}&fields=files(id,name)` +
        '&supportsAllDrives=true&includeItemsFromAllDrives=true',
      {},
      auth.token,
    ).catch(() => ({ files: [] }))) as { files?: { id: string; name: string }[] };

    const hit = found.files?.[0];
    if (!hit) break;
    chain.push(hit);
    parent = hit.id;
  }

  // Deepest first: a parent can only be empty once its child has gone.
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const folder = chain[i]!;
    // Never the root, whatever was passed in.
    if (folder.id === rootId) break;

    const children = (await api(
      `/files?q=${encodeURIComponent(`'${folder.id}' in parents and trashed = false`)}` +
        '&fields=files(id)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true',
      {},
      auth.token,
    ).catch(() => null)) as { files?: { id: string }[] } | null;

    // Could not read it, or it still holds something — stop climbing.
    if (children === null || (children.files?.length ?? 0) > 0) break;

    const res = await fetch(
      `${API}/files/${folder.id}?supportsAllDrives=true`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      },
    );
    if (!res.ok) break;
    trashed.push(folder.name);
  }

  return { trashed };
}

/**
 * Move a file to a different folder when its status changes.
 *
 * Drive keeps the file id across a move, so every link already shared, and
 * every id stored here, stays valid.
 */
export async function moveFile(
  fileId: string,
  toFolderId: string,
): Promise<{ ok: boolean; error?: string }> {
  const auth = await token();
  if ('error' in auth) return { ok: false, error: auth.error };

  try {
    const current = (await api(
      `/files/${fileId}?fields=parents&supportsAllDrives=true`,
      {},
      auth.token,
    )) as { parents?: string[] };

    const remove = (current.parents ?? []).join(',');
    await api(
      `/files/${fileId}?addParents=${toFolderId}` +
        `${remove ? `&removeParents=${remove}` : ''}&fields=id&supportsAllDrives=true`,
      { method: 'PATCH', body: JSON.stringify({}) },
      auth.token,
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not move the file' };
  }
}
