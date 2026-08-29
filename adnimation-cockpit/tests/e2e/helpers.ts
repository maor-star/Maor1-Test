import type { Locator, Page } from '@playwright/test';

/**
 * The tasks page carries two forms with overlapping field labels — the filter
 * bar and the create form. Scope to the create form explicitly; picking the
 * first match silently drives the filters instead.
 */
export function newTaskForm(page: Page): Locator {
  return page.locator('form', { has: page.getByPlaceholder('מה צריך לקרות?') });
}

export async function createTask(
  page: Page,
  title: string,
  opts: { priority?: 'P0' | 'P1' | 'P2' | 'P3' } = {},
): Promise<void> {
  const form = newTaskForm(page);
  await form.getByLabel('כותרת').fill(title);
  if (opts.priority) await form.getByLabel('עדיפות').selectOption(opts.priority);
  await form.getByRole('button', { name: 'הוספה' }).click();
}

/** The table row holding a task with this title. */
export function taskRow(page: Page, title: string): Locator {
  return page.locator('tr', { has: page.getByRole('link', { name: title, exact: true }) });
}
