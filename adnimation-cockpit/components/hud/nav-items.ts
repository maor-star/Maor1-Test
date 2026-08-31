/**
 * The module list, shared by the desktop rail and the mobile sheet so the two
 * can never drift apart. Numbered as the design does.
 */
export const NAV = [
  { href: '/', label: 'OVERVIEW', num: '01', ready: true },
  { href: '/revenue', label: 'REVENUE', num: '02', ready: true },
  { href: '/tasks', label: 'TASKS', num: '03', ready: true },
  { href: '/delegations', label: 'DELEGATIONS', num: '04', ready: true },
  // Pipeline sits directly after opportunities: it is where one goes once it
  // matures, and the two are read together.
  { href: '/opportunities', label: 'OPPORTUNITIES', num: '05', ready: true },
  { href: '/pipeline', label: 'PIPELINE', num: '06', ready: true },
  { href: '/mail', label: 'MAIL', num: '07', ready: true },
  { href: '/contracts', label: 'CONTRACTS', num: '08', ready: true },
  { href: '/clients', label: 'CLIENTS', num: '09', ready: true },
  { href: '/crm', label: 'CRM', num: '10', ready: true },
  { href: '/seats/demand', label: 'DEMAND', num: '11', ready: true },
  { href: '/seats/supply', label: 'SUPPLY', num: '12', ready: true },
  { href: '/trading', label: 'TRADING', num: '13', ready: true },
  { href: '/agents', label: 'AGENTS', num: '14', ready: false },
] as const;

export type NavItem = (typeof NAV)[number];
