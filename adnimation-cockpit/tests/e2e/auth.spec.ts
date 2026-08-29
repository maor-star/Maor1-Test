import { test, expect } from './fixtures';

test.describe('access control', () => {
  test('an unauthenticated request is redirected to the login page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    // Google only renders when an OAuth client is configured; the password
    // form is the sign-in surface that is always present.
    await expect(page.getByRole('button', { name: 'SIGN IN', exact: true })).toBeVisible();
  });

  test('every app route is gated, not just the home page', async ({ page }) => {
    for (const path of ['/tasks', '/delegations']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  });

  /**
   * Regression: the first cut of the middleware checked only that a session
   * cookie *existed*. A request carrying any junk value got past it, the page
   * rendered, and although the layout then redirected, the response body still
   * carried the streamed Server Component payload — real task titles and staff
   * names — to an unauthenticated caller.
   */
  test('a forged session cookie leaks no data in the redirect body', async ({ page, context }) => {
    await context.addCookies([
      { name: 'authjs.session-token', value: 'totally-invalid-junk', domain: '127.0.0.1', path: '/' },
    ]);
    const response = await page.goto('/');
    const body = (await response?.text()) ?? '';

    await expect(page).toHaveURL(/\/login/);
    for (const secret of ['PubMatic', 'Fill Rate', 'sellers.json', 'Heat Score']) {
      expect(body, `redirect body must not contain "${secret}"`).not.toContain(secret);
    }
  });

  test('a valid session reaches the cockpit', async ({ signedIn }) => {
    const page = await signedIn.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Cockpit' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Burning today' }).first()).toBeVisible();
  });
});
