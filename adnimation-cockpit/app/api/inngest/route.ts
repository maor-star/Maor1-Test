import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { clickUpPoll, delegationWatch, taskHygiene } from '@/inngest/functions';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [clickUpPoll, taskHygiene, delegationWatch],
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
