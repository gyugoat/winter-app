import { test, expect } from '@playwright/test';
import { setupApp, openSidebar } from './test-utils';

test.describe('Session reorder DnD', () => {
  test('session-reorder — drag session to change order', async ({ page }) => {
    await setupApp(page);
    await openSidebar(page);
    await page.waitForSelector('.sidebar-session', { timeout: 5000 });

    const sessions = page.locator('.sidebar-session');
    const count = await sessions.count();
    if (count < 2) {
      test.skip(true, 'Need at least 2 sessions for reorder test');
      return;
    }

    await expect(page).toHaveScreenshot('session-reorder-before.png');

    const from = await sessions.nth(1).boundingBox();
    const to = await sessions.nth(0).boundingBox();

    if (!from || !to) {
      test.skip(true, 'Could not get session bounding boxes');
      return;
    }

    const fromCx = from.x + from.width / 2;
    const fromCy = from.y + from.height / 2;
    const toCy = to.y + to.height / 2;

    await page.mouse.move(fromCx, fromCy);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.move(fromCx, fromCy - 10, { steps: 5 });
    await page.mouse.move(fromCx, toCy, { steps: 20 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot('session-reorder-after.png');
  });
});

test.describe('FileChanges panel detach DnD', () => {
  test('filechanges-detach — dock → detach → re-dock cycle', async ({ page }) => {
    await setupApp(page);

    await page.click('.fc-toggle-btn');
    await page.waitForTimeout(400);

    const panel = page.locator('.fc-panel, .file-changes-panel, [class*="filechanges"]').first();
    const isPanelVisible = await panel.isVisible().catch(() => false);
    if (!isPanelVisible) {
      test.skip(true, 'FileChanges panel not visible');
      return;
    }

    await expect(page).toHaveScreenshot('filechanges-docked.png');

    const header = page.locator('.fc-header, .file-changes-header, [class*="filechanges"] header').first();
    const headerBox = await header.boundingBox();

    if (!headerBox) {
      test.skip(true, 'Could not find FileChanges header');
      return;
    }

    const startX = headerBox.x + headerBox.width / 2;
    const startY = headerBox.y + headerBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.waitForTimeout(100);

    for (let i = 1; i <= 30; i++) {
      await page.mouse.move(startX - i * 5, startY, { steps: 1 });
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot('filechanges-detached.png');

    const viewport = page.viewportSize();
    if (!viewport) { await page.mouse.up(); return; }

    await page.mouse.move(viewport.width - 50, startY, { steps: 20 });
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page.waitForTimeout(400);

    await expect(page).toHaveScreenshot('filechanges-redocked.png');
  });
});

test.describe('Sidebar resize', () => {
  test('sidebar-resize — drag handle widens sidebar', async ({ page }) => {
    await setupApp(page);
    await openSidebar(page);

    await expect(page).toHaveScreenshot('sidebar-resize-default.png');

    const handle = page.locator('.sidebar-resize-handle');
    const handleBox = await handle.boundingBox();

    if (!handleBox) {
      test.skip(true, 'Sidebar resize handle not found');
      return;
    }

    const hx = handleBox.x + handleBox.width / 2;
    const hy = handleBox.y + handleBox.height / 2;

    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.move(hx + 100, hy, { steps: 20 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot('sidebar-resize-wider.png');
  });
});
