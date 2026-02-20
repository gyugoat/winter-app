import { test, expect } from '@playwright/test';
import { setupApp, openSidebar, openSettingsPopup } from './test-utils';

test.describe('Chat views', () => {
  test('chat-default', async ({ page }) => {
    await setupApp(page);
    await expect(page).toHaveScreenshot('chat-default.png');
  });

  test('chat-with-messages', async ({ page }) => {
    await setupApp(page);
    await page.waitForSelector('.message-list', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('chat-with-messages.png');
  });

  test('chat-streaming', async ({ page }) => {
    await setupApp(page);
    await page.evaluate(() => {
      const bubble = document.querySelector('.msg-bubble');
      if (bubble) {
        const status = document.createElement('span');
        status.className = 'msg-status-text';
        status.textContent = 'thinking...';
        bubble.appendChild(status);
      }
    });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('chat-streaming.png');
  });
});

test.describe('Sidebar states', () => {
  test('sidebar-open', async ({ page }) => {
    await setupApp(page);
    await openSidebar(page);
    await expect(page).toHaveScreenshot('sidebar-open.png');
  });

  test('sidebar-with-sessions', async ({ page }) => {
    await setupApp(page);
    await openSidebar(page);
    await page.waitForSelector('.sidebar-session', { timeout: 3000 });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('sidebar-with-sessions.png');
  });

  test('sidebar-kebab-menu', async ({ page }) => {
    await setupApp(page);
    await openSidebar(page);
    await page.waitForSelector('.sidebar-session', { timeout: 3000 });
    await page.evaluate(() => {
      const kebab = document.querySelector('.sidebar-kebab') as HTMLElement | null;
      if (kebab) {
        kebab.style.opacity = '1';
        kebab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }
    });
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('sidebar-kebab-menu.png');
  });

  test('sidebar-rename', async ({ page }) => {
    await setupApp(page);
    await openSidebar(page);
    await page.waitForSelector('.sidebar-session', { timeout: 3000 });
    await page.evaluate(() => {
      const kebab = document.querySelector('.sidebar-kebab') as HTMLElement | null;
      if (kebab) {
        kebab.style.opacity = '1';
        kebab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }
    });
    await page.waitForTimeout(300);
    const renameItem = page.locator('.sidebar-menu-item').first();
    await renameItem.waitFor({ state: 'visible', timeout: 3000 });
    await page.evaluate(() => {
      const item = document.querySelector('.sidebar-menu-item') as HTMLElement | null;
      if (item) item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    });
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('sidebar-rename.png');
  });

  test('sidebar-settings-popup', async ({ page }) => {
    await setupApp(page);
    await openSidebar(page);
    await openSettingsPopup(page);
    await expect(page).toHaveScreenshot('sidebar-settings-popup.png');
  });

  test('sidebar-settings-theme', async ({ page }) => {
    await setupApp(page);
    await openSidebar(page);
    await openSettingsPopup(page);
    await page.locator('.settings-popup-item', { hasText: 'Theme' }).click();
    await page.waitForSelector('.settings-sub-popup', { timeout: 3000 });
    await page.waitForTimeout(150);
    await expect(page).toHaveScreenshot('sidebar-settings-theme.png');
  });

  test('sidebar-settings-token', async ({ page }) => {
    await setupApp(page);
    await openSidebar(page);
    await openSettingsPopup(page);
    await page.locator('.settings-popup-item', { hasText: 'Token' }).click();
    await page.waitForSelector('.settings-sub-popup', { timeout: 3000 });
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('sidebar-settings-token.png');
  });
});

test.describe('Settings pages', () => {
  test('settings-shortcuts', async ({ page }) => {
    await setupApp(page);
    await openSidebar(page);
    await openSettingsPopup(page);
    await page.locator('.settings-popup-item', { hasText: 'Shortcuts' }).click();
    await page.waitForSelector('.settings-subpage', { timeout: 3000 });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('settings-shortcuts.png');
  });

  test('settings-personalize', async ({ page }) => {
    await setupApp(page);
    await openSidebar(page);
    await openSettingsPopup(page);
    await page.locator('.settings-popup-item', { hasText: 'Personalize' }).click();
    await page.waitForSelector('.settings-subpage', { timeout: 3000 });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('settings-personalize.png');
  });

  test('settings-language', async ({ page }) => {
    await setupApp(page);
    await openSidebar(page);
    await openSettingsPopup(page);
    await page.locator('.settings-popup-item', { hasText: 'Language' }).click();
    await page.waitForSelector('.settings-subpage', { timeout: 3000 });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('settings-language.png');
  });

  test('settings-archive', async ({ page }) => {
    await setupApp(page);
    await openSidebar(page);
    await openSettingsPopup(page);
    await page.locator('.settings-popup-item', { hasText: 'Archive' }).click();
    await page.waitForSelector('.settings-subpage', { timeout: 3000 });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('settings-archive.png');
  });

  test('settings-feedback', async ({ page }) => {
    await setupApp(page);
    await openSidebar(page);
    await openSettingsPopup(page);
    await page.locator('.settings-popup-item', { hasText: 'Send feedback' }).click();
    await page.waitForSelector('.settings-subpage', { timeout: 3000 });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('settings-feedback.png');
  });

  test('settings-ollama', async ({ page }) => {
    await setupApp(page);
    await openSidebar(page);
    await openSettingsPopup(page);
    await page.locator('.settings-popup-item', { hasText: 'Local LLM' }).click();
    await page.waitForSelector('.settings-subpage', { timeout: 3000 });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('settings-ollama.png');
  });

  test('settings-folder', async ({ page }) => {
    await setupApp(page);
    await openSidebar(page);
    await page.locator('.sidebar-select-folder-btn').click();
    await page.waitForSelector('.settings-subpage', { timeout: 3000 });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('settings-folder.png');
  });
});

test.describe('FileChanges panel', () => {
  test('filechanges-open', async ({ page }) => {
    await setupApp(page);
    await page.click('.fc-toggle-btn');
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('filechanges-open.png');
  });

  test('filechanges-all-files', async ({ page }) => {
    await setupApp(page);
    await page.click('.fc-toggle-btn');
    await page.waitForTimeout(300);
    const allFilesTab = page.locator('button').filter({ hasText: /all files/i });
    if (await allFilesTab.count() > 0) {
      await allFilesTab.first().click();
      await page.waitForTimeout(300);
    }
    await expect(page).toHaveScreenshot('filechanges-all-files.png');
  });
});

test.describe('Input bar', () => {
  test('input-default', async ({ page }) => {
    await setupApp(page);
    await page.waitForSelector('.input-bar', { timeout: 5000 });
    await expect(page).toHaveScreenshot('input-default.png');
  });

  test('input-with-text', async ({ page }) => {
    await setupApp(page);
    await page.waitForSelector('.input-field', { timeout: 5000 });
    await page.locator('.input-field').click();
    await page.keyboard.type('Build me a REST API with authentication');
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('input-with-text.png');
  });

  test('input-streaming-stop', async ({ page }) => {
    await setupApp(page);
    await page.evaluate(() => {
      const stopBtn = document.querySelector('.input-send.input-stop') as HTMLElement | null;
      if (stopBtn) {
        stopBtn.style.display = 'flex';
        stopBtn.style.opacity = '1';
      }
      const sendBtn = document.querySelector('.input-send:not(.input-stop)') as HTMLElement | null;
      if (sendBtn) sendBtn.style.display = 'none';
    });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('input-streaming-stop.png');
  });
});

test.describe('Search bar', () => {
  test('search-open', async ({ page }) => {
    await setupApp(page);
    await page.keyboard.press('Control+f');
    await page.waitForTimeout(400);
    const searchBar = page.locator('.chat-search-bar');
    if (!await searchBar.isVisible().catch(() => false)) {
      await page.evaluate(() => {
        const el = document.querySelector('.chat-search-bar') as HTMLElement | null;
        if (el) el.style.display = 'flex';
      });
      await page.waitForTimeout(200);
    }
    await expect(page).toHaveScreenshot('search-open.png');
  });
});
