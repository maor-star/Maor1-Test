/**
 * The module list, shared by the desktop rail and the mobile sheet so the two
 * can never drift apart. Numbered as the design does.
 */
export const NAV = [
  { href: '/', label: 'OVERVIEW', num: '01', ready: true },
  // The copilot sits beside the overview: the overview is what the company
  // is doing; the copilot is who is minding it.
  { href: '/copilot', label: 'COPILOT', num: '00', ready: true },
  { href: '/revenue', label: 'REVENUE', num: '02', ready: true },
  { href: '/tasks', label: 'TASKS', num: '03', ready: true },
  { href: '/delegations', label: 'DELEGATIONS', num: '04', ready: true },
  // One board for everything from "somebody mentioned it" to "it is live".
  { href: '/pipeline', label: 'DEALS', num: '05', ready: true },
  { href: '/mail', label: 'MAIL', num: '06', ready: true },
  { href: '/contracts', label: 'CONTRACTS', num: '07', ready: true },
  { href: '/crm', label: 'CRM', num: '08', ready: true },
  { href: '/seats/demand', label: 'DEMAND', num: '09', ready: true },
  { href: '/seats/supply', label: 'SUPPLY', num: '10', ready: true },
  { href: '/trading', label: 'TRADING', num: '11', ready: true },
  { href: '/agents', label: 'AGENTS', num: '12', ready: true },
  { href: '/settings', label: 'KEYS', num: '13', ready: true },
  // Where the posts written in his name wait for him to publish them.
  { href: '/marketing', label: 'MARKETING', num: '14', ready: true },
] as const;

export type NavItem = (typeof NAV)[number];
