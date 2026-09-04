#!/usr/bin/env node
/**
 * Is the Calendly token working, and what is his booking link?
 *
 *   CALENDLY_TOKEN=… node calendly-check.mjs
 *
 * Read-only, and it prints the link and the event types — never the token.
 * The link is the thing the meetings agent sends when it cannot read the
 * calendar, so knowing it is live matters as much as the token being valid.
 */
const TOKEN = process.env.CALENDLY_TOKEN;
if (!TOKEN) {
  console.error('CALENDLY_TOKEN is not set.');
  process.exit(78);
}

const api = async (path) => {
  const res = await fetch(`https://api.calendly.com${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message ?? `http_${res.status}`);
  return body;
};

/**
 * Who the token belongs to.
 *
 * A personal access token minted without the `user:read` scope cannot call
 * /users/me at all — which is the shape of his. The token itself carries the
 * user's uuid in its payload, and the uuid is the whole of the user URI, so
 * the identity is read from there rather than asked for. Only the uuid is
 * used; nothing about the token is printed.
 */
function userUriFromToken() {
  try {
    const payload = JSON.parse(Buffer.from(TOKEN.split('.')[1], 'base64url').toString('utf8'));
    return payload.user_uuid ? `https://api.calendly.com/users/${payload.user_uuid}` : null;
  } catch {
    return null;
  }
}

try {
  const me = await api('/users/me').catch(() => null);
  const user = me?.resource ?? { uri: userUriFromToken(), name: '(needs the user:read scope)' };
  if (!user.uri) throw new Error('cannot tell whose token this is');
  console.log(`user: ${user.name}${user.email ? ` <${user.email}>` : ''}`);
  if (user.scheduling_url) console.log(`link: ${user.scheduling_url}`);
  if (user.timezone) console.log(`timezone: ${user.timezone}`);

  const types = await api(`/event_types?user=${encodeURIComponent(user.uri)}&active=true`);
  for (const type of types.collection ?? []) {
    console.log(`event: ${type.duration}min  ${type.name}  ${type.scheduling_url}`);
  }
  process.exit(0);
} catch (e) {
  console.error(`calendly: ${e.message}`);
  process.exit(1);
}
