'use client';

import { createContext, useContext } from 'react';
import { PILLAR_OPTIONS, type PillarOption } from '@/lib/control/pillars';

/**
 * The pillar list, handed to the browser once per page.
 *
 * The chips are ticked and shown in five different client components sitting
 * four levels down inside boards — threading the list through every one of
 * them as a prop would have meant touching every row, card and form on three
 * screens to add a field none of them cares about. The shell reads the list
 * once and puts it here instead.
 *
 * The built-in seven are the fallback, so a component rendered outside the
 * shell (a test, a preview) still shows a sensible row rather than nothing.
 */
const PillarsContext = createContext<PillarOption[]>(PILLAR_OPTIONS);

export function PillarsProvider({
  value,
  children,
}: {
  value: PillarOption[];
  children: React.ReactNode;
}) {
  return <PillarsContext.Provider value={value}>{children}</PillarsContext.Provider>;
}

/** The pillars as he has them now. */
export function usePillars(): PillarOption[] {
  return useContext(PillarsContext);
}
