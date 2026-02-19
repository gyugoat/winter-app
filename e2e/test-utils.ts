import { type Page } from '@playwright/test';
import { installTauriMock } from './tauri-mock';

export async function setupApp(page: Page): Promise<void> {
  await page.addInitScript(installTauriMock);
  await page.goto('http://localhost:1420');

  const splashVisible = await page.locator('.splash').isVisible({ timeout: 4000 }).catch(() => false);
  if (splashVisible) {
    await page.click('.splash');
    await page.waitForTimeout(2500);
  }

  await page.waitForSelector('.chat-layout', { timeout: 15_000 });
  await page.waitForTimeout(600);
}

export function makeFakeSession(overrides: {
  id?: string;
  name?: string;
  messageCount?: number;
} = {}) {
  const id = overrides.id ?? Math.random().toString(36).slice(2, 10);
  const name = overrides.name ?? 'Test session';
  const count = overrides.messageCount ?? 2;
  const messages = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      id: Math.random().toString(36).slice(2, 10),
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: i % 2 === 0 ? `User message ${i + 1}` : `Assistant reply ${i + 1}`,
      timestamp: Date.now() - (count - i) * 60_000,
    });
  }
  return { id, name, messages, createdAt: Date.now() - count * 60_000 };
}

export async function openSidebar(page: Page): Promise<void> {
  await page.click('.sidebar-toggle-btn');
  await page.waitForSelector('.sidebar.open', { timeout: 3000 });
  await page.waitForTimeout(200);
}

export async function openSettingsPopup(page: Page): Promise<void> {
  await page.click('.sidebar-settings-btn');
  await page.waitForSelector('.settings-popup', { timeout: 3000 });
  await page.waitForTimeout(150);
}
