/**
 * The one name the search box and the instant filter agree on.
 *
 * Its own file because the box is a client component the pages import and the
 * filter is another; a shared constant between them should not drag either
 * into the other's bundle.
 */
export const SEARCH_EVENT = 'cockpit:search';

export interface SearchEventDetail {
  param: string;
  value: string;
}
