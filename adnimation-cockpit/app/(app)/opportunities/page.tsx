import { redirect } from 'next/navigation';

/**
 * Opportunities and the pipeline are one board now.
 *
 * The route stays so a bookmark, a Slack message or an old mail link still
 * lands somewhere real. Whatever view it asked for, the answer is the deals
 * board — the suggestions inbox sits at the top of it.
 */
export default function OpportunitiesPage() {
  redirect('/pipeline');
}
