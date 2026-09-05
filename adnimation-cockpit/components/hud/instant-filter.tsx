'use client';

import { useEffect, useState } from 'react';
import { foldForSearch } from '@/lib/search';
import { SEARCH_EVENT, type SearchEventDetail } from './search-event';

/**
 * The list narrows as he types, before the server has heard about it.
 *
 * The query lives in the URL — that is what makes a search shareable and what
 * survives a reload — but a URL is a navigation, and a navigation on a screen
 * holding a hundred contract cards is a server render he waits two seconds
 * for. Per keystroke. What he described was a search box that does not seem to
 * search; what it was doing was searching four times and showing him the last
 * one, late.
 *
 * So the URL still gets the query, and the list stops waiting for it. Every
 * row carries the text it can be found by in `data-search`, folded the same
 * way the server folds it, and this injects one rule that hides the rows whose
 * text is missing a word he has typed. Attribute matching is the browser's own
 * job, so it is instant however long the list is, and the server's answer —
 * the same answer — replaces it when it arrives without anything moving.
 *
 * The rule is `[data-search*="a"][data-search*="b"]`, one clause per word, so
 * it means what matchesQuery means: every word, in any field, in any order.
 */

/** A CSS string literal: only " and \ can break out of one. */
const quote = (term: string) => term.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function InstantFilter({ param = 'q', scope }: { param?: string; scope: string }) {
  const [terms, setTerms] = useState<string[]>([]);

  useEffect(() => {
    const onSearch = (event: Event) => {
      const detail = (event as CustomEvent<SearchEventDetail>).detail;
      if (detail.param !== param) return;
      setTerms(foldForSearch(detail.value).trim().split(/\s+/).filter(Boolean));
    };
    window.addEventListener(SEARCH_EVENT, onSearch);
    return () => window.removeEventListener(SEARCH_EVENT, onSearch);
  }, [param]);

  if (terms.length === 0) return null;

  const clauses = terms.map((t) => `[data-search*="${quote(t)}"]`).join('');
  return (
    <style>{`#${scope} [data-search]:not(${clauses}) { display: none !important; }`}</style>
  );
}
