/**
 * Revenue departments — as the source itself defines them.
 *
 * The Ad Ops Architect system groups every revenue row by `category`, and that
 * grouping is the company's real revenue structure: Google, Header Bidding,
 * Video, Content Recommendations, EBDA. This file makes that grouping the
 * cockpit's department axis rather than translating it into an invented one.
 *
 * An earlier version mapped these categories onto the eight units the spec
 * sketched. That mapping was a guess — nothing in the data stated which unit
 * owned which category — and it put unconfirmed department names against real
 * money on the CEO's screen. Reading the source's own grouping removes both the
 * guess and the caveat.
 *
 * Note this is a different taxonomy from the ClickUp lists that departments in
 * the tasks module come from. They answer different questions: this one is
 * "where does the revenue come from", that one is "who does the work". Keeping
 * them separate is deliberate.
 */

export const REVENUE_DEPARTMENTS = [
  'google',
  'header_bidding',
  'video',
  'content_recommendations',
  'ebda',
] as const;

export type RevenueDept = (typeof REVENUE_DEPARTMENTS)[number];

export const DEPARTMENT_LABEL: Record<string, string> = {
  google: 'GOOGLE (GAM)',
  header_bidding: 'HEADER BIDDING',
  video: 'VIDEO',
  content_recommendations: 'CONTENT RECOMMENDATIONS',
  ebda: 'EBDA',
  // Categories the source flags as not revenue: Analytics, Deductions,
  // Expenses. Excluded at the query, but named here so an unexpected row is
  // labelled rather than silently folded into a real department.
  ignored: 'NOT REVENUE (EXCLUDED)',
};

export const departmentLabel = (dept: string): string =>
  DEPARTMENT_LABEL[dept] ?? dept.replace(/_/g, ' ').toUpperCase();

/** True for the categories the source counts as revenue. */
export function isRevenueDept(dept: string): dept is RevenueDept {
  return (REVENUE_DEPARTMENTS as readonly string[]).includes(dept);
}

/**
 * The department a revenue row belongs to. It is the source's own category, so
 * this is an identity — kept as a function because every call site should go
 * through one place if the source ever adds a category.
 */
export function departmentFor(category: string): string {
  return category.trim() || 'unknown';
}

/** Display order: largest, most structural lines first. */
export function sortDepartments<T extends { deptCode: string }>(rows: T[]): T[] {
  const order = [...REVENUE_DEPARTMENTS] as string[];
  return [...rows].sort((a, b) => {
    const ai = order.indexOf(a.deptCode);
    const bi = order.indexOf(b.deptCode);
    return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
  });
}
