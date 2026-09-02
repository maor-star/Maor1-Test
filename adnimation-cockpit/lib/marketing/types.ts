/**
 * The shapes the marketing screen and the service agree on.
 *
 * Kept apart from the service so a client component can import them without
 * dragging the database into the browser bundle — which is exactly what
 * happened the first time, and the build said so.
 */

/** The longest LinkedIn accepts in one post. */
export const MAX_POST_CHARS = 3000;

export interface Draft {
  id: string;
  sourceKind: string;
  sourceRef: string | null;
  occasion: string;
  body: string;
  flags: string[];
  status: string;
  postedUrl: string | null;
  postedAt: Date | null;
  createdAt: Date;
  model: string | null;
}
