import { redirect } from 'next/navigation';

/**
 * The clients screen was folded into the overview.
 *
 * The route stays so a bookmark or an open tab lands on the home screen —
 * where the control panel and the core clients now are — rather than on a
 * 404 that reads as "the site is down".
 */
export default function ClientsPage() {
  redirect('/');
}
