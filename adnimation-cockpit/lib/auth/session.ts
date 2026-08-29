import { redirect } from 'next/navigation';
import { auth } from '@/auth';

export interface CockpitUser {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'operator';
}

/** Every page and server action in /(app) goes through this. */
export async function requireUser(): Promise<CockpitUser> {
  const session = await auth();
  if (!session?.user?.email) redirect('/login');
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? session.user.email,
    role: session.user.role,
  };
}

/**
 * Spec §2 — the operator does everything except signing authority and agent
 * configuration. Those two surfaces call this.
 */
export async function requireOwner(): Promise<CockpitUser> {
  const user = await requireUser();
  if (user.role !== 'owner') redirect('/?denied=owner-only');
  return user;
}
