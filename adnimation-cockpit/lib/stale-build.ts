/**
 * Was this error a tab left open across a deploy, or something really wrong?
 *
 * The two need opposite treatment — one reloads itself, the other stops and
 * says so — and the distinction is only ever a string match on what the
 * browser threw, so it lives here where it can be tested rather than inside
 * the error boundary where it cannot.
 */
const STALE =
  /ChunkLoadError|Loading chunk [\d]+ failed|Loading CSS chunk|dynamically imported module|Importing a module script failed/i;

export function isStaleBuild(error: { name?: string; message?: string }): boolean {
  return STALE.test(`${error.name ?? ''} ${error.message ?? ''}`);
}
