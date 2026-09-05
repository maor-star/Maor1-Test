import { test, expect } from '@playwright/test';

/**
 * The owner account signs in with a password. Everything else is refused:
 * the wrong password, a different address, and an address outside the allowlist.
 */
const OWNER = process.env.OWNER_EMAIL ?? 'maor@adnimation.com';
const PASSWORD = process.env.E2E_OWNER_PASSWORD ?? 'Vv123123';

test.describe('password sign-in', () => {
  test('the owner signs in and reaches the cockpit', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'SIGN IN' }).click();

    await expect(page.getByRole('heading', { name: 'Cockpit' })).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/\/$|\/\?/);
  });

  test('a wrong password is refused, without saying which field was wrong', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'SIGN IN' }).click();

    await expect(page.getByText('Incorrect email or password.')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('another address cannot sign in, even with the right password', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('mor@adnimation.com');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'SIGN IN' }).click();

    await expect(page.getByText('Incorrect email or password.')).toBeVisible();
  });

  test('an address outside the allowlist cannot sign in', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('attacker@evil.com');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'SIGN IN' }).click();

    await expect(page.getByText('Incorrect email or password.')).toBeVisible();
  });

  test('the cockpit is still gated without a session', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page).toHaveURL(/\/login/);
  });
});
