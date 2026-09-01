/**
 * GENERATED FROM lib/sync/mirror-skip.ts — do not edit by hand.
 *
 * The jobs run as plain ESM outside the compiled app, so they need a
 * JavaScript copy of these rules. tests/unit/mirror-skip-parity.test.ts
 * feeds both this file and the TypeScript original the same inputs and fails
 * if they ever disagree, so an edit to one without the other cannot ship.
 *
 * Regenerate with: node deploy/build-detect.mjs
 */
/**
 * Whose ClickUp tasks are not his.
 *
 * The first version of this rule skipped anything assigned only to Mor or only
 * to Tomer, and it was wrong: most of what sits under Mor's name is work he
 * wrote and handed over, which is exactly the work he wants to watch. What is
 * genuinely not his is the pair — the tasks Mor and Tomer run between them.
 *
 * So the rule is now narrow twice over. A task is skipped only when EVERY name
 * on the pair list is assigned to it, and it is never skipped when he is on it
 * himself, whoever else is. That means:
 *
 *   Mor alone                 → kept. Usually his work, delegated.
 *   Tomer alone               → kept.
 *   Mor and Tomer             → skipped. Theirs to run between them.
 *   Mor, Tomer and Maor       → kept. He is on it.
 *   Unassigned                → kept. It belongs to nobody, so not to them.
 *
 * Both lists are configuration — TASK_MIRROR_SKIP_PAIR and TASK_MIRROR_KEEP,
 * comma separated — so changing who this covers is a setting, not a deploy.
 *
 * Nothing here touches a task he wrote in the cockpit: every query the mirror
 * runs is scoped to `layer = 'company'`, and his own tasks are `layer = 'mine'`
 * with no ClickUp id at all.
 */

/** Skipped only when all of these are on the same task. */
export const DEFAULT_SKIP_PAIR = ['mor@adnimation.com', 'treves@adnimation.com'];

/** Anyone here on a task keeps it, whoever else is assigned. */
export const DEFAULT_KEEP = ['maor@adnimation.com'];

const parse = (raw) =>
  raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export function skipPair(raw = process.env.TASK_MIRROR_SKIP_PAIR) {
  return raw === undefined ? DEFAULT_SKIP_PAIR : parse(raw);
}

export function keepList(raw = process.env.TASK_MIRROR_KEEP) {
  return raw === undefined ? DEFAULT_KEEP : parse(raw);
}

export function shouldMirror(assigneeEmails, pair = skipPair(), keep = keepList()) {
  // A pair of one would skip everything that person touches, which is the
  // mistake this rule was rewritten to undo.
  if (pair.length < 2) return true;

  const assignees = assigneeEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (assignees.length === 0) return true;

  const keepers = keep.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (assignees.some((email) => keepers.includes(email))) return true;

  const theirs = pair.map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !theirs.every((email) => assignees.includes(email));
}
