import { test as base, type BrowserContext } from '@playwright/test';
import { mintSessionCookie } from './session-cookie';

/** A browser context already carrying a valid owner session. */
export const test = base.extend<{ signedIn: BrowserContext }>({
  signedIn: async ({ browser, baseURL }, use) => {
    const context = await browser.newContext({ baseURL });
    const cookie = await mintSessionCookie({
      email: process.env.ALLOWED_EMAILS?.split(',')[0]?.trim() ?? 'maor@adnimation.com',
      name: 'Maor Davidovich',
      role: 'owner',
    });
    const url = new URL(baseURL ?? 'http://127.0.0.1:3100');
    await context.addCookies([
      { name: cookie.name, value: cookie.value, domain: url.hostname, path: '/' },
    ]);
    await use(context);
    await context.close();
  },
});

export { expect } from '@playwright/test';
