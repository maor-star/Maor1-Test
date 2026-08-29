import { test, expect } from './fixtures';
import { createTask, taskRow } from './helpers';

/**
 * Milestone 1 acceptance (CLAUDE.md §8): delegating produces a Slack message
 * and a ClickUp task, and the delegation is tracked. Against the fakes both
 * side effects show up as live links in the tracker; a failed side effect
 * renders as a red ✕ instead, so this genuinely distinguishes the two.
 */
test.describe('delegation', () => {
  test('delegating fires both side effects and is tracked', async ({ signedIn }) => {
    const page = await signedIn.newPage();
    const title = `Automated delegation ${Date.now()}`;

    await page.goto('/tasks');
    await createTask(page, title);
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();

    await taskRow(page, title).getByRole('button', { name: 'DELEGATE' }).click();

    await page.getByLabel('Assign to').selectOption({ index: 1 });
    await page.getByLabel('Context').fill('Created by an automated check');
    await page.getByRole('button', { name: 'SEND' }).click();

    // The source task moves to "delegated, waiting" (spec 6.1.3 step 5).
    await expect(taskRow(page, title).getByText('DELEGATED')).toBeVisible();

    await page.goto('/delegations');
    const tracked = page.locator('tr', { hasText: title });
    await expect(tracked).toBeVisible();
    await expect(tracked.getByRole('link', { name: /Slack/ })).toBeVisible();
    await expect(tracked.getByRole('link', { name: /ClickUp/ })).toBeVisible();
  });
});
