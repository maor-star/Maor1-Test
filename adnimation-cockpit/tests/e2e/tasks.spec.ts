import { test, expect } from './fixtures';
import { createTask, newTaskForm, taskRow } from './helpers';

const unique = (label: string) => `${label} ${Date.now()}`;

test.describe('tasks', () => {
  test('creates a task and shows it in the list', async ({ signedIn }) => {
    const page = await signedIn.newPage();
    const title = unique('בדיקה אוטומטית');

    await page.goto('/tasks');
    await createTask(page, title, { priority: 'P0' });

    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
    await expect(taskRow(page, title).getByText('בוער')).toBeVisible();
  });

  test('rejects a task with no title, server-side', async ({ signedIn }) => {
    const page = await signedIn.newPage();
    await page.goto('/tasks');

    const form = newTaskForm(page);
    // Bypass the browser's required-field check the way a crafted request would.
    await form.getByLabel('כותרת').evaluate((el) => el.removeAttribute('required'));
    await form.getByRole('button', { name: 'הוספה' }).click();

    await expect(page.getByText('חובה למלא כותרת')).toBeVisible();
  });

  test('completing a task removes it from the open list', async ({ signedIn }) => {
    const page = await signedIn.newPage();
    const title = unique('לסגירה');

    await page.goto('/tasks');
    await createTask(page, title);
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();

    await taskRow(page, title).getByRole('button', { name: 'סגור' }).click();

    await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0);
  });

  test('a mirrored ClickUp task offers no write actions', async ({ signedIn }) => {
    const page = await signedIn.newPage();
    await page.goto('/tasks?layer=company');
    const rows = page.locator('tbody tr');
    if ((await rows.count()) === 0) test.skip(true, 'no mirrored tasks in this database');

    const first = rows.first();
    await expect(first.getByRole('button', { name: 'סגור' })).toHaveCount(0);
    await expect(first.getByRole('button', { name: 'האצל' })).toHaveCount(0);
    await expect(first.getByText('ClickUp', { exact: true })).toBeVisible();
  });

  test('switches between list, board and calendar views', async ({ signedIn }) => {
    const page = await signedIn.newPage();
    await page.goto('/tasks');
    await page.getByRole('link', { name: 'לוח', exact: true }).click();
    await expect(page).toHaveURL(/view=board/);
    await page.getByRole('link', { name: 'לוח שנה' }).click();
    await expect(page).toHaveURL(/view=calendar/);
  });
});
