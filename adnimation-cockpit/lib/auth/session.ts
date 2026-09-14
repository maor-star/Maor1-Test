import { redirect } from 'next/navigation';
import { auth } from '@/auth';

export interface CockpitUser {
  id: string;
  email: string;
  name: string;
  /** `collaborator` reaches the tasks board and nothing else. */
  role: 'owner' | 'operator' | 'collaborator';
  /** Set only for a collaborator: whether they may change what they see. */
  taskLevel?: 'view' | 'edit';
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
    taskLevel: session.user.taskLevel,
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

/**
 * Anything that is not the tasks board.
 *
 * The middleware already turns a collaborator away from these, so reaching
 * this is either a route it does not cover or a page rendered another way.
 * Both are worth a second door rather than an assumption.
 */
export async function requireAccountHolder(): Promise<CockpitUser> {
  const user = await requireUser();
  if (user.role === 'collaborator') redirect('/tasks');
  return user;
}
