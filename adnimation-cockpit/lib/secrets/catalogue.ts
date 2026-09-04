/**
 * The credentials the cockpit knows how to use.
 *
 * Declared rather than free-form on purpose: a settings screen that accepts
 * any key name is a screen where a typo looks exactly like a working
 * credential until the job it feeds fails at four in the morning. Each entry
 * says what it unlocks and where to get it, because the answer to "what do I
 * paste here" should be on the screen and not in a document he has to find.
 */

export interface SecretSpec {
  key: string;
  label: string;
  /** What stops working without it, in his terms. */
  unlocks: string;
  /** Where the value comes from. */
  where: string;
  group: 'models' | 'publishing' | 'data' | 'scheduling';
  /** A value that is not a secret — an id, a URN — and can be shown back. */
  public?: boolean;
  placeholder?: string;
}

export const SECRETS: SecretSpec[] = [
  {
    key: 'LOVABLE_API_KEY',
    label: 'Lovable API key',
    unlocks: 'The control panel and the P&L refreshing themselves every three hours instead of holding the last snapshot.',
    where: 'Lovable → the adops-architect project → Settings → API keys.',
    group: 'data',
  },
  {
    key: 'LOVABLE_PROJECT_ID',
    label: 'Lovable project id',
    unlocks: 'Which project the two syncs read. Without it they do not know where to look.',
    where: 'The id in the project URL.',
    group: 'data',
    public: true,
    placeholder: '43925edf-…',
  },
  {
    key: 'SLACK_USER_TOKEN',
    label: 'Slack user token (yours)',
    unlocks:
      'The Copilot reading your whole Slack and searching it. Without it the cockpit only sees the channels its bot was invited to. It still posts as the cockpit, never as you.',
    where:
      'api.slack.com → your Slack app → OAuth & Permissions → User Token Scopes: search:read, channels:history, channels:read, groups:history, groups:read, im:history, mpim:history → Reinstall → copy the token starting xoxp-.',
    group: 'data',
    placeholder: 'xoxp-…',
  },
  {
    key: 'CALENDLY_LINK',
    label: 'Your Calendly link',
    unlocks:
      'The meetings agent sending a booking link. It is what it sends when the calendar scope ' +
      'is not delegated yet, and what it puts under the three times it offers when it is.',
    where: 'calendly.com → your event type → Copy link. Any booking link works, not only Calendly.',
    group: 'scheduling',
    public: true,
    placeholder: 'https://calendly.com/maor/30min',
  },
  {
    key: 'CALENDLY_TOKEN',
    label: 'Calendly API token',
    unlocks:
      'Optional. Lets the cockpit see bookings made through the link — who booked and when — ' +
      'instead of only sending it. Nothing breaks without it.',
    where: 'calendly.com → Integrations → API & Webhooks → Personal access token.',
    group: 'scheduling',
  },
  {
    key: 'GEMINI_API_KEY',
    label: 'Gemini API key',
    unlocks: 'Gemini as a second model in the Copilot, and image generation for the marketing agent.',
    where: 'Google AI Studio → aistudio.google.com/apikey → Create API key.',
    group: 'models',
  },
  {
    key: 'LINKEDIN_ACCESS_TOKEN',
    label: 'LinkedIn access token',
    unlocks: 'The marketing agent posting to LinkedIn. Without it, it still drafts — you copy and paste.',
    where: 'LinkedIn Developers → your app → Auth → a token with w_member_social.',
    group: 'publishing',
  },
  {
    key: 'LINKEDIN_AUTHOR_URN',
    label: 'LinkedIn author',
    unlocks: 'Who the post is published as — you, or the company page.',
    where: 'urn:li:person:… for you, urn:li:organization:… for the company page.',
    group: 'publishing',
    public: true,
    placeholder: 'urn:li:person:xxxxxxxx',
  },
];

export const GROUP_LABEL: Record<SecretSpec['group'], string> = {
  models: 'MODELS',
  data: 'THE DATA SOURCE',
  publishing: 'PUBLISHING',
  scheduling: 'MEETINGS',
};

export const SECRET_KEYS = SECRETS.map((s) => s.key);

export function specFor(key: string): SecretSpec | null {
  return SECRETS.find((s) => s.key === key) ?? null;
}
