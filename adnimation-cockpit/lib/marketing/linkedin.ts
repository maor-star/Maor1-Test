import { secret } from '@/lib/secrets/store';

/**
 * Publishing to LinkedIn.
 *
 * The only code in the cockpit that says something to the public internet, so
 * it is deliberately small and deliberately dumb: it takes text somebody has
 * read, posts it, and hands back the link. It decides nothing. No agent calls
 * it — the one caller is the action behind his PUBLISH button.
 *
 * One credential he has to paste: LINKEDIN_ACCESS_TOKEN, a token with
 * w_member_social. Who the post goes out as is worked out from that token —
 * his own profile — so he never has to find and type a URN. He can still set
 * LINKEDIN_AUTHOR_URN by hand to publish as the company page instead.
 *
 * Without a token the cockpit still drafts; publishing says what is missing
 * instead of failing obscurely.
 */

const POSTS = 'https://api.linkedin.com/rest/posts';
/** Who the token belongs to. `sub` is the member id the author URN is built from. */
const USERINFO = 'https://api.linkedin.com/v2/userinfo';
const IMAGES_INIT = 'https://api.linkedin.com/rest/images?action=initializeUpload';
/** The API is versioned by date and rejects a request without one. */
const VERSION = '202405';

/**
 * LinkedIn's "little text" format treats a dozen punctuation marks as markup
 * and rejects a post that uses one unescaped. A backslash in front is the
 * whole rule, and it is invisible in the published post.
 */
export function escapeCommentary(text: string): string {
  return text.replace(/[()[\]{}<>@|~_*\\]/g, (c) => `\\${c}`);
}

export interface PublishResult {
  ok: boolean;
  url?: string | null;
  urn?: string | null;
  error?: string;
}

export interface LinkedInCredentials {
  token: string;
  author: string;
}

/**
 * The author URN out of the member id the token identifies.
 *
 * Split from the network call so the shaping is testable on its own: a URN
 * built wrong is a post that goes to nobody, and the failure looks like a
 * permissions problem.
 */
export function personUrn(memberId: unknown): string | null {
  return typeof memberId === 'string' && memberId.trim() !== ''
    ? `urn:li:person:${memberId.trim()}`
    : null;
}

/** Resolved once per token, because it cannot change while the token lasts. */
const authorCache = new Map<string, string>();

/**
 * Who this token posts as.
 *
 * He asked for his own profile, and hit the thing everybody hits: LinkedIn
 * makes you attach a Company Page to create the developer app at all, which
 * reads as though the app can only post to that page. It cannot — the page is
 * a requirement of the app, and who a post is authored by is a separate
 * question answered by this token. So the cockpit asks the token.
 */
export async function resolveAuthor(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const cached = authorCache.get(token);
  if (cached) return cached;

  const res = await fetcher(USERINFO, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!res || !res.ok) return null;
  const body = await res.json().catch(() => null);
  const urn = personUrn((body as { sub?: unknown } | null)?.sub);
  if (urn) authorCache.set(token, urn);
  return urn;
}

export async function linkedInCredentials(): Promise<LinkedInCredentials | { missing: string[] }> {
  const [token, stored] = await Promise.all([secret('LINKEDIN_ACCESS_TOKEN'), secret('LINKEDIN_AUTHOR_URN')]);
  if (!token) return { missing: ['LINKEDIN_ACCESS_TOKEN'] };

  /*
   * What he set wins. Nothing set means his own profile, worked out from the
   * token — which is what he asked for and one less thing to paste.
   */
  const author = stored ?? (await resolveAuthor(token));
  if (!author) {
    return { missing: ['LINKEDIN_AUTHOR_URN'] };
  }
  return { token, author };
}

export interface PostImage {
  bytes: Buffer;
  mime: string;
  /** Alt text — the occasion, usually. */
  title: string;
}

export type Publisher = (
  text: string,
  credentials: LinkedInCredentials,
  image?: PostImage | null,
) => Promise<PublishResult>;

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'LinkedIn-Version': VERSION,
  'X-Restli-Protocol-Version': '2.0.0',
});

/**
 * A picture goes up in two steps: LinkedIn hands out an upload URL and an
 * image urn, the bytes go to the URL, and the urn goes into the post.
 */
async function uploadImage(image: PostImage, { token, author }: LinkedInCredentials): Promise<{ urn: string } | { error: string }> {
  const init = await fetch(IMAGES_INIT, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
  });
  const body = (await init.json().catch(() => null)) as { value?: { uploadUrl?: string; image?: string } } | null;
  if (!init.ok || !body?.value?.uploadUrl || !body.value.image) {
    return { error: `LinkedIn would not take the picture (${init.status}).` };
  }

  const put = await fetch(body.value.uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': image.mime },
    body: new Uint8Array(image.bytes),
  });
  if (!put.ok) return { error: `The picture upload failed (${put.status}).` };
  return { urn: body.value.image };
}

/** The real one. Separated so the action can be tested without a network. */
export const publishToLinkedIn: Publisher = async (text, credentials, image) => {
  let media: { id: string; title: string } | null = null;
  if (image) {
    const up = await uploadImage(image, credentials);
    if ('error' in up) return { ok: false, error: up.error };
    media = { id: up.urn, title: image.title.slice(0, 200) };
  }

  const res = await fetch(POSTS, {
    method: 'POST',
    headers: headers(credentials.token),
    body: JSON.stringify({
      author: credentials.author,
      commentary: escapeCommentary(text),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
      ...(media ? { content: { media } } : {}),
    }),
  });

  if (res.status !== 201 && !res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `LinkedIn refused it (${res.status}): ${body.slice(0, 300)}` };
  }

  // The new post's urn comes back in a header, not the body.
  const urn = res.headers.get('x-restli-id');
  return {
    ok: true,
    urn,
    url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : null,
  };
};

/** In-memory LinkedIn. Tests assert against `posted` and `images`. */
export class FakePublisher {
  readonly posted: string[] = [];
  readonly images: (PostImage | null)[] = [];
  failWith: string | null = null;

  publish: Publisher = async (text, _credentials, image) => {
    if (this.failWith) return { ok: false, error: this.failWith };
    this.posted.push(text);
    this.images.push(image ?? null);
    return { ok: true, urn: `urn:li:share:${this.posted.length}`, url: `https://linkedin.test/${this.posted.length}` };
  };
}
