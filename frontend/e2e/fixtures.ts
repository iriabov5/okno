import { test as base, type Page } from '@playwright/test';

export const test = base.extend<{ openPage: () => Promise<Page> }>({
  page: async ({ page }, use, testInfo) => {
    if (process.env.E2E_COVERAGE !== 'true') return use(page);
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    try {
      await use(page);
    } finally {
      const coverage = await page.coverage.stopJSCoverage();
      await testInfo.attach('browser-coverage', {
        body: JSON.stringify(coverage),
        contentType: 'application/json',
      });
    }
  },

  openPage: async ({ browser, baseURL }, use, testInfo) => {
    const pages: Page[] = [];
    try {
      await use(async () => {
        const page = await browser.newPage({ baseURL });
        pages.push(page);
        if (process.env.E2E_COVERAGE === 'true') {
          await page.coverage.startJSCoverage({ resetOnNavigation: false });
        }
        return page;
      });
    } finally {
      for (const page of pages) {
        if (process.env.E2E_COVERAGE === 'true') {
          const coverage = await page.coverage.stopJSCoverage();
          await testInfo.attach('browser-coverage', {
            body: JSON.stringify(coverage),
            contentType: 'application/json',
          });
        }
        await page.close();
      }
    }
  },
});

export { expect } from '@playwright/test';
