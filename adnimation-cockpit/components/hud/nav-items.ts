/**
 * The module list, shared by the desktop rail and the mobile sheet so the two
 * can never drift apart. Numbered as the design does.
 */
export const NAV = [
  { href: '/', label: 'CADENCE', num: '01', ready: true },
  { href: '/revenue', label: 'REVENUE', num: '02', ready: true },
  { href: '/tasks', label: 'TASKS', num: '03', ready: true },
  { href: '/delegations', label: 'DELEGATIONS', num: '04', ready: true },
  { href: '/contracts', label: 'CONTRACTS', num: '05', ready: true },
  { href: '/clients', label: 'CLIENTS', num: '06', ready: true },
  { href: '/crm', label: 'CRM', num: '07', ready: true },
  { href: '/seats/demand', label: 'DEMAND', num: '08', ready: true },
  { href: '/seats/supply', label: 'SUPPLY', num: '09', ready: true },
  { href: '/inbox', label: 'SIGNALS', num: '10', ready: false },
  { href: '/pipeline', label: 'PIPELINE', num: '11', ready: false },
  { href: '/agents', label: 'AGENTS', num: '12', ready: false },
] as const;

export type NavItem = (typeof NAV)[number];
