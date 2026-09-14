import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      /**
       * `collaborator` is somebody he granted the tasks board to. They have no
       * account anywhere else in the cockpit, and the middleware holds them to
       * that.
       */
      role: 'owner' | 'operator' | 'collaborator';
      /** Set only for a collaborator: whether they may change what they see. */
      taskLevel?: 'view' | 'edit';
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
