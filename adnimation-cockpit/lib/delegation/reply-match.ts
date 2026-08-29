/**
 * Which words in an ask a real reply would echo.
 *
 * Short words match everything, so they are dropped; the cap keeps a long note
 * from turning into a filter that matches any mail the person ever sent. Unicode
 * classes rather than \w, because the notes are written in Hebrew.
 */
export function matchTerms(taskTitle: string | null, note: string | null): string[] {
  const source = [taskTitle, note].filter(Boolean).join(' ');
  return [...new Set(source.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4))].slice(0, 6);
}
