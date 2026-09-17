/**
 * An email reduced to what was actually written in it.
 *
 * The first copy stored Gmail's plain-text part as it came, and the numbers
 * said what was wrong with that: 589 messages, 522 of them carrying a quoted
 * reply chain, an average of 6,700 characters each, and one in three hitting
 * the twelve-thousand cap. A thread of eight messages was the same conversation
 * stored eight times, and the newest message — the one he opened the task to
 * read — was the likeliest to be the one cut off.
 *
 * So the quoted tail comes off. What is left is the message, which is usually
 * a paragraph.
 */

/**
 * Where the quoting starts.
 *
 * Every mail client marks it, and each marks it differently, so this is a list
 * of the ones that actually appear in his mailbox — Gmail's "On … wrote:",
 * Outlook's rule and From:/Sent: block, the classic separator, and the Hebrew
 * forms, because half of this mailbox replies in Hebrew.
 */
const QUOTE_MARKERS: RegExp[] = [
  /^On .{6,120}\bwrote:\s*$/i,
  /^On .{6,120},\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^-{2,}\s*Forwarded message\s*-{2,}\s*$/i,
  /^_{10,}\s*$/,
  /^From:\s*.+$/i,
  /^Sent:\s*.+$/i,
  /^בתאריך .{4,120}(כתב|כתבה|כתבו):?\s*$/,
  /^ב-.{4,120}(כתב|כתבה|כתבו):?\s*$/,
  /^מאת:\s*.+$/,
  /^נשלח:\s*.+$/,
];

/** The lines a client adds under the message and above the quote. */
const SIGN_OFF = /^(--\s*|__+\s*|Sent from my .{0,40})$/i;

const isQuoteStart = (line: string) => QUOTE_MARKERS.some((r) => r.test(line.trim()));

/**
 * The message without the conversation it is replying to.
 *
 * Cuts at the first quote marker, or at a run of quoted lines, whichever comes
 * first — and keeps everything when neither appears, which is what a first
 * message in a thread looks like.
 *
 * Never returns empty from a non-empty input: a reply that is nothing but
 * "Thanks" above a quote would otherwise vanish, and "he answered with one
 * word" is information. When the trim would leave nothing, the original is
 * kept instead.
 */
export function withoutQuotes(raw: string): string {
  const text = normalise(raw);
  if (text === '') return '';

  const lines = text.split('\n');
  let cut = lines.length;

  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    if (isQuoteStart(line)) {
      cut = i;
      break;
    }
    /*
     * Two quoted lines in a row. One on its own is not enough — a message can
     * open with "> yes" as a deliberate quote of one point, and cutting there
     * would throw away the answer under it.
     */
    if (line.startsWith('>') && (lines[i + 1] ?? '').trim().startsWith('>')) {
      cut = i;
      break;
    }
  }

  const kept = tidy(lines.slice(0, cut).join('\n'));
  return kept === '' ? text : kept;
}

/** Carriage returns, non-breaking spaces and zero-width junk, gone. */
export function normalise(raw: string): string {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[​-‏‪-‮﻿]/g, '')
    .trim();
}

/** Trailing sign-off lines and runs of blank lines. */
function tidy(text: string): string {
  const lines = normalise(text).split('\n');
  while (lines.length > 0 && SIGN_OFF.test((lines.at(-1) ?? '').trim())) lines.pop();
  while (lines.length > 0 && (lines.at(-1) ?? '').trim() === '') lines.pop();
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * What gets stored, and whether it had to be cut.
 *
 * The cap is on the message alone now that the quoted history is off it, so
 * almost nothing reaches it — and what does is marked rather than silently
 * shortened, with a link to the rest in Gmail on the screen.
 */
export function bodyToStore(raw: string, limit = 12_000): { body: string; truncated: boolean } {
  const text = withoutQuotes(raw);
  if (text.length <= limit) return { body: text, truncated: false };
  return { body: text.slice(0, limit), truncated: true };
}
