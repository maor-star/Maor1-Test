/**
 * The shape of an update, and how to name who wrote it.
 *
 * Its own module with nothing under it: the panel that draws these is a client
 * component, and a client component that reaches lib/db — even through a
 * re-export — fails the build with "Can't resolve 'net'". The rule lives here;
 * lib/tasks/updates.ts, which does touch the database, re-exports it.
 */
export interface UpdateTrail {
  /** Newest first, capped — the panel shows a few, the page shows all. */
  latest: TaskUpdate[];
  /** Everything, so the panel can say there is more than it is showing. */
  total: number;
}

export interface TaskUpdate {
  id: string;
  author: string;
  body: string;
  createdAt: Date;
}

/**
 * Who wrote it, in a form a person recognises.
 *
 * The column holds an address, because that is what a session carries. On a
 * row it wants to be a name, and the part before the @ is the whole of what he
 * needs to tell Mor from Assaf when nothing better is to hand.
 */
export function authorLabel(author: string, people: { email: string; name: string }[] = []): string {
  const match = people.find((p) => p.email.toLowerCase() === author.toLowerCase());
  if (match) return match.name;
  const at = author.indexOf('@');
  return at > 0 ? author.slice(0, at) : author;
}
