import type { ClientType } from './types';

/**
 * Going live, step by step.
 *
 * "Integration" as one stage is the stage a deal dies in: it can sit there for
 * two months and the board says the same word on day one and day sixty. What
 * he needs to see is which of the half-dozen things has actually happened —
 * because the answer to "why is this not live" is always one specific missing
 * step, and it is nearly always waiting on somebody who does not know it.
 *
 * The steps are the ones this business actually runs, and they differ by side:
 * a demand partner is plugged in at the endpoint, a publisher is plugged in on
 * their own pages. Both end at revenue, because revenue is the only proof.
 */

export interface IntegrationStep {
  key: string;
  label: string;
  /** What "done" means, said plainly, so two people cannot tick it differently. */
  meaning: string;
}

const SHARED_START: IntegrationStep[] = [
  { key: 'contract', label: 'Contract signed', meaning: 'Both sides have signed. Not "agreed on a call".' },
  { key: 'kickoff', label: 'Technical contact named', meaning: 'You have the name and address of whoever does the work on their side.' },
];

const SHARED_END: IntegrationStep[] = [
  { key: 'test', label: 'Test traffic passing', meaning: 'Requests are flowing and coming back filled, on a test property.' },
  { key: 'qa', label: 'QA and brand safety cleared', meaning: 'Creatives, latency and IVT checked on real inventory.' },
  { key: 'revenue', label: 'First revenue recorded', meaning: 'Money has appeared in the reports. This is the only proof it is live.' },
];

/** The technical middle, which is the part that differs by side. */
const DEMAND_MIDDLE: IntegrationStep[] = [
  { key: 'seat', label: 'Seat / account opened', meaning: 'They have created the buying seat or account on their side.' },
  { key: 'endpoint', label: 'Endpoint connected', meaning: 'The OpenRTB endpoint or tag is exchanging requests, either direction.' },
  { key: 'sellers', label: 'sellers.json / ads.txt lines in place', meaning: 'The lines they need are published and visible to them.' },
];

const SUPPLY_MIDDLE: IntegrationStep[] = [
  { key: 'adstxt', label: 'ads.txt / app-ads.txt lines live', meaning: 'Our lines are on their domain and crawlable.' },
  { key: 'tags', label: 'Tags or SDK deployed', meaning: 'The code is on their pages or in their build, in production.' },
  { key: 'placements', label: 'Placements mapped', meaning: 'Every placement we are buying is named and matched on both sides.' },
];

const GENERAL_MIDDLE: IntegrationStep[] = [
  { key: 'setup', label: 'Set up on both sides', meaning: 'Whatever this arrangement needs technically has been done.' },
];

/*
 * Every list is start, then the technical middle, then the shared end — and
 * it always ends at revenue, whatever the side. Building a mutual list by
 * concatenating two whole lists put test, QA and revenue in the middle of it,
 * which read as though the deal was finished before half its work began.
 */
const list = (middle: IntegrationStep[]): IntegrationStep[] => [
  ...SHARED_START,
  ...middle,
  ...SHARED_END,
];

export const DEMAND_STEPS: IntegrationStep[] = list(DEMAND_MIDDLE);
export const SUPPLY_STEPS: IntegrationStep[] = list(SUPPLY_MIDDLE);
export const GENERAL_STEPS: IntegrationStep[] = list(GENERAL_MIDDLE);

/** A mutual partner integrates on both sides, so it carries both middles. */
export const MUTUAL_STEPS: IntegrationStep[] = list([...DEMAND_MIDDLE, ...SUPPLY_MIDDLE]);

export function stepsFor(clientType: ClientType): IntegrationStep[] {
  if (clientType === 'demand') return DEMAND_STEPS;
  if (clientType === 'supply' || clientType === 'publisher') return SUPPLY_STEPS;
  if (clientType === 'mutual') return MUTUAL_STEPS;
  return GENERAL_STEPS;
}

export interface StepState {
  done: boolean;
  at?: string | null;
  note?: string | null;
  /** Who or what is holding it up, when it is not done. */
  blockedOn?: string | null;
}

export type IntegrationState = Record<string, StepState>;

export interface IntegrationProgress {
  steps: (IntegrationStep & StepState)[];
  done: number;
  total: number;
  /** 0–1. The board shows this as a bar; nothing decides anything on it. */
  ratio: number;
  /** The first step not done — the answer to "why is this not live". */
  waitingOn: (IntegrationStep & StepState) | null;
  complete: boolean;
}

/** What is stored, read against what the steps are, with junk ignored. */
export function readState(stored: unknown): IntegrationState {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  const out: IntegrationState = {};
  for (const [key, raw] of Object.entries(stored as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const v = raw as Record<string, unknown>;
    out[key] = {
      done: v.done === true,
      at: typeof v.at === 'string' ? v.at : null,
      note: typeof v.note === 'string' ? v.note.slice(0, 500) : null,
      blockedOn: typeof v.blockedOn === 'string' ? v.blockedOn.slice(0, 200) : null,
    };
  }
  return out;
}

export function progressFor(clientType: ClientType, stored: unknown): IntegrationProgress {
  const state = readState(stored);
  const steps = stepsFor(clientType).map((s) => ({
    ...s,
    done: state[s.key]?.done ?? false,
    at: state[s.key]?.at ?? null,
    note: state[s.key]?.note ?? null,
    blockedOn: state[s.key]?.blockedOn ?? null,
  }));
  const done = steps.filter((s) => s.done).length;

  return {
    steps,
    done,
    total: steps.length,
    ratio: steps.length === 0 ? 0 : done / steps.length,
    waitingOn: steps.find((s) => !s.done) ?? null,
    complete: steps.length > 0 && done === steps.length,
  };
}

/** One step ticked or unticked, with the rest left exactly as it was. */
export function setStep(
  stored: unknown,
  key: string,
  patch: { done?: boolean; note?: string | null; blockedOn?: string | null },
  now = new Date(),
): IntegrationState {
  const state = readState(stored);
  const before = state[key] ?? { done: false };
  const done = patch.done ?? before.done;
  return {
    ...state,
    [key]: {
      done,
      // The date a step was ticked is how long it took; unticking clears it,
      // because a step ticked twice did not take from the first tick.
      at: done ? (before.done ? (before.at ?? now.toISOString()) : now.toISOString()) : null,
      note: patch.note !== undefined ? patch.note : (before.note ?? null),
      blockedOn: patch.blockedOn !== undefined ? patch.blockedOn : (before.blockedOn ?? null),
    },
  };
}

/**
 * Whether a deal looks finished.
 *
 * Not a decision — the cockpit never closes a deal by itself — but the prompt
 * that makes closing occur to him. Without it a won deal sits on the board for
 * ever, and a board that is mostly finished work stops being read.
 */
export function looksDone(
  stage: string,
  progress: IntegrationProgress,
): { done: boolean; why: string } {
  if (stage === 'lost') return { done: true, why: 'It was lost — close it and say why.' };
  if (stage === 'live' && progress.complete) {
    return { done: true, why: 'It is live and every integration step is ticked.' };
  }
  if (stage === 'live') {
    return {
      done: false,
      why: `Live, but ${progress.total - progress.done} integration step(s) are still open.`,
    };
  }
  return { done: false, why: '' };
}

export const CLOSE_OUTCOMES = ['won', 'lost'] as const;
export type CloseOutcome = (typeof CLOSE_OUTCOMES)[number];

export const CLOSE_LABEL: Record<CloseOutcome, string> = {
  won: 'WON — LIVE AND EARNING',
  lost: 'LOST',
};
