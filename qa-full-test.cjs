const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const consoleLogs = [];
  const networkErrors = [];
  const apiCalls = [];

  page.on('console', msg => {
    const entry = { type: msg.type(), text: msg.text() };
    if (msg.type() === 'error') consoleErrors.push(entry);
    else consoleLogs.push(entry);
  });

  page.on('pageerror', error => {
    consoleErrors.push({ type: 'pageerror', text: error.message, stack: error.stack?.substring(0, 300) });
  });

  page.on('requestfailed', request => {
    networkErrors.push({ url: request.url(), failure: request.failure()?.errorText });
  });

  page.on('response', response => {
    const url = response.url();
    if (url.includes('/session') || url.includes('/event') || url.includes('/global/') ||
        url.includes('/file') || url.includes('/path') || url.includes('/config') ||
        url.includes('/api/') || url.includes('/vcs') || url.includes('/question')) {
      apiCalls.push({
        url: url.replace('http://127.0.0.1:8890', ''),
        status: response.status(),
        type: response.headers()['content-type']?.substring(0, 60) || ''
      });
    }
  });

  // ==================== STEP 1: Load page ====================
  console.log('=== STEP 1: Loading page ===');
  await page.goto('http://127.0.0.1:8890/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/qa-screenshots/20-splash.png' });
  console.log('Screenshot: 20-splash.png (splash screen)');

  // ==================== STEP 2: Click splash to continue ====================
  console.log('\n=== STEP 2: Clicking splash screen ===');
  await page.click('.splash');
  await page.waitForTimeout(3000); // 1.6s greeting + 0.5s fade + buffer
  
  await page.screenshot({ path: '/tmp/qa-screenshots/21-after-splash-click.png' });
  console.log('Screenshot: 21-after-splash-click.png');

  // Check what phase we're in now
  const afterSplash = await page.evaluate(() => {
    const root = document.getElementById('root');
    return {
      htmlLen: root?.innerHTML?.length || 0,
      firstChildClass: String(root?.firstElementChild?.className || ''),
      hasSplash: !!document.querySelector('.splash'),
      visibleText: document.body.innerText.trim().substring(0, 500),
    };
  });
  console.log('After splash click:', JSON.stringify(afterSplash, null, 2));

  // Wait for app to fully load
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/qa-screenshots/22-app-loaded.png' });
  console.log('Screenshot: 22-app-loaded.png');

  // Check if we need to handle readme or auth
  const currentPhase = await page.evaluate(() => {
    const root = document.getElementById('root');
    const inner = root?.innerHTML || '';
    if (inner.includes('readme') || inner.includes('Readme') || inner.includes('README')) return 'readme';
    if (inner.includes('auth') || inner.includes('Auth') || inner.includes('authenticate')) return 'auth';
    if (inner.includes('sidebar') || inner.includes('session') || inner.includes('chat')) return 'chat';
    return 'unknown: ' + inner.substring(0, 200);
  });
  console.log('Current phase:', currentPhase);

  // If readme, try clicking through it
  if (currentPhase === 'readme') {
    console.log('  Handling README screen...');
    // Look for a "continue" or "done" button
    const btn = await page.locator('button').first();
    if (await btn.count() > 0) {
      await btn.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: '/tmp/qa-screenshots/23-after-readme.png' });
    }
  }

  // If auth, try clicking "skip"
  if (currentPhase === 'auth') {
    console.log('  Handling Auth screen...');
    const skipBtn = await page.locator('button:has-text("skip"), button:has-text("Skip"), [class*="skip"]');
    if (await skipBtn.count() > 0) {
      await skipBtn.first().click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: '/tmp/qa-screenshots/23-after-auth.png' });
    }
  }

  // Wait for main chat to load
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/qa-screenshots/24-main-view.png' });
  console.log('Screenshot: 24-main-view.png');

  // ==================== STEP 3: Analyze main app state ====================
  console.log('\n=== STEP 3: Main app state analysis ===');
  
  const appState = await page.evaluate(() => {
    const root = document.getElementById('root');
    const allElements = document.querySelectorAll('*');
    const classes = new Set();
    allElements.forEach(el => {
      const cls = String(el.className || '');
      cls.split(/\s+/).forEach(c => { if (c.length > 2) classes.add(c); });
    });

    // Find sidebar sessions
    const sessionEls = document.querySelectorAll('[class*="session"], [class*="Session"], [data-session]');
    const sidebarLinks = [];
    document.querySelectorAll('a, button, [role="button"]').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.x < 350 && rect.width > 20 && rect.height > 10) {
        sidebarLinks.push({
          text: el.textContent.trim().substring(0, 60),
          tag: el.tagName,
          cls: String(el.className || '').substring(0, 60),
          y: Math.round(rect.y),
          h: Math.round(rect.height)
        });
      }
    });

    return {
      pageClasses: [...classes].sort().slice(0, 50),
      sessionElements: sessionEls.length,
      sidebarLinks,
      bodyText: document.body.innerText.trim().substring(0, 1000),
      rootHtmlLen: root?.innerHTML?.length || 0,
    };
  });
  
  console.log('Root HTML length:', appState.rootHtmlLen);
  console.log('Session elements:', appState.sessionElements);
  console.log('Sidebar links:', JSON.stringify(appState.sidebarLinks.slice(0, 10), null, 2));
  console.log('Body text (first 500):', appState.bodyText.substring(0, 500));
  console.log('Page classes:', appState.pageClasses.join(', '));

  // ==================== STEP 4: Try clicking a session ====================
  console.log('\n=== STEP 4: Click a session ===');
  
  // Find clickable items in the sidebar area
  const sidebarItems = await page.evaluate(() => {
    const items = [];
    document.querySelectorAll('a, button, [role="button"], [class*="item"], [class*="row"]').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.x < 350 && rect.width > 50 && rect.height > 20 && rect.y > 40 &&
          el.textContent.trim().length > 3) {
        items.push({
          text: el.textContent.trim().substring(0, 80),
          tag: el.tagName,
          cls: String(el.className || '').substring(0, 80),
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        });
      }
    });
    return items;
  });

  console.log('Sidebar items found:', sidebarItems.length);
  sidebarItems.slice(0, 10).forEach((item, i) => 
    console.log(`  ${i}: [${item.tag}] "${item.text}" (${item.w}x${item.h} at ${item.x},${item.y})`)
  );

  if (sidebarItems.length > 0) {
    // Click the first session item
    const target = sidebarItems[0];
    console.log(`\n  Clicking: "${target.text}"...`);
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/qa-screenshots/25-session-clicked.png' });
    console.log('Screenshot: 25-session-clicked.png');
    
    // Check messages area
    const messagesState = await page.evaluate(() => {
      const msgEls = document.querySelectorAll('[class*="message"], [class*="Message"], pre, code, [class*="markdown"]');
      const mainArea = document.querySelector('main, [class*="main"], [class*="content"], [class*="chat"]');
      return {
        messageElements: msgEls.length,
        mainAreaText: mainArea?.innerText?.substring(0, 500) || '(no main area found)',
        bodyTextAfterClick: document.body.innerText.substring(0, 1000)
      };
    });
    console.log('Messages after click:', messagesState.messageElements);
    console.log('Main area text:', messagesState.mainAreaText.substring(0, 300));
  }

  // ==================== STEP 5: Check File Changes / All Files ====================
  console.log('\n=== STEP 5: Check All Files tab ===');
  
  // Look for tabs
  const tabs = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('button, [role="tab"], [class*="tab"], [class*="Tab"]').forEach(el => {
      const text = el.textContent.trim();
      if (text.length > 0 && text.length < 50) {
        const rect = el.getBoundingClientRect();
        results.push({
          text,
          tag: el.tagName,
          cls: String(el.className || '').substring(0, 80),
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
          visible: rect.width > 0 && rect.height > 0
        });
      }
    });
    return results;
  });
  
  const fileTabs = tabs.filter(t => 
    t.text.toLowerCase().includes('file') || t.text.toLowerCase().includes('change') || t.text.toLowerCase().includes('all')
  );
  console.log('File-related tabs:', fileTabs.length);
  fileTabs.forEach((t, i) => console.log(`  ${i}: "${t.text}" visible=${t.visible} cls=${t.cls}`));

  if (fileTabs.length > 0) {
    const allFilesTab = fileTabs.find(t => t.text.toLowerCase().includes('all file')) || fileTabs[0];
    console.log(`  Clicking: "${allFilesTab.text}"...`);
    await page.mouse.click(allFilesTab.x, allFilesTab.y);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/qa-screenshots/26-all-files.png' });
    console.log('Screenshot: 26-all-files.png');

    const filesState = await page.evaluate(() => {
      const noFiles = document.body.innerText.includes('No files') || document.body.innerText.includes('No file');
      // Find file listing area
      const fileListEls = document.querySelectorAll('[class*="file"], [class*="File"]');
      return {
        noFilesVisible: noFiles,
        fileElements: fileListEls.length,
        bodyText: document.body.innerText.substring(0, 500)
      };
    });
    console.log('Files state:', JSON.stringify(filesState));
  }

  // ==================== STEP 6: Final summary screenshots ====================
  console.log('\n=== STEP 6: Wide-view screenshot ===');
  await page.screenshot({ path: '/tmp/qa-screenshots/27-final-wide.png', fullPage: true });
  console.log('Screenshot: 27-final-wide.png');

  // ==================== SUMMARY ====================
  console.log('\n\n========== QA RESULTS SUMMARY ==========');
  
  console.log(`\nConsole Errors (${consoleErrors.length}):`);
  consoleErrors.forEach(e => console.log(`  [${e.type}] ${e.text.substring(0, 300)}`));
  if (consoleErrors.length === 0) console.log('  (none)');

  console.log(`\nNetwork Errors (${networkErrors.length}):`);
  networkErrors.forEach(e => console.log(`  ${e.url} — ${e.failure}`));
  if (networkErrors.length === 0) console.log('  (none)');

  console.log(`\nAPI Calls (${apiCalls.length}):`);
  apiCalls.forEach(c => console.log(`  [${c.status}] ${c.url.substring(0, 100)} (${c.type})`));

  console.log(`\nConsole Logs (${consoleLogs.length}, showing first 20):`);
  consoleLogs.slice(0, 20).forEach(l => console.log(`  [${l.type}] ${l.text.substring(0, 200)}`));

  await browser.close();
  console.log('\n=== QA test complete ===');
})();
