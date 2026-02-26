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
    consoleErrors.push({ type: 'pageerror', text: error.message, stack: error.stack?.substring(0, 500) });
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
        type: response.headers()['content-type']?.substring(0, 60) || '',
        time: Date.now()
      });
    }
  });

  // ==================== Navigate through splash + readme + auth ====================
  console.log('=== Phase 1: Navigate to main app ===');
  
  await page.goto('http://127.0.0.1:8890/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);
  
  // Click splash
  console.log('  Clicking splash...');
  await page.click('.splash');
  await page.waitForTimeout(2500);

  // Check if README is showing, click "Let's go!" 
  const hasReadme = await page.locator('.readme').count() > 0;
  if (hasReadme) {
    console.log('  README screen detected, clicking "Let\'s go!"...');
    // Scroll down to make sure the button is visible, then click
    await page.evaluate(() => {
      const btn = document.querySelector('.readme-confirm-btn');
      if (btn) btn.scrollIntoView();
    });
    await page.waitForTimeout(500);
    await page.click('.readme-confirm-btn');
    await page.waitForTimeout(2000);
  }

  // Check if Auth screen is showing
  const hasAuth = await page.evaluate(() => {
    return document.body.innerText.includes('authenticate') || 
           document.body.innerText.includes('Authenticate') ||
           document.body.innerText.includes('Sign in') ||
           document.body.innerText.includes('Skip');
  });
  if (hasAuth) {
    console.log('  Auth screen detected, looking for Skip...');
    try {
      await page.click('button:has-text("Skip")', { timeout: 2000 });
      await page.waitForTimeout(2000);
    } catch {
      console.log('  No Skip button found');
    }
  }

  // Wait for main chat to load
  console.log('  Waiting for app to load...');
  await page.waitForTimeout(5000);

  // ==================== MAIN APP SCREENSHOTS ====================
  console.log('\n=== Phase 2: Main app screenshots ===');
  
  await page.screenshot({ path: '/tmp/qa-screenshots/30-main-app.png' });
  console.log('Screenshot: 30-main-app.png');

  // Analyze the main view
  const mainState = await page.evaluate(() => {
    const root = document.getElementById('root');
    const allText = document.body.innerText.trim();
    
    // Collect all visible elements with text
    const visibleItems = [];
    document.querySelectorAll('*').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && el.children.length === 0) {
        const text = el.textContent?.trim();
        if (text && text.length > 2 && text.length < 200) {
          visibleItems.push({
            text: text.substring(0, 80),
            tag: el.tagName,
            cls: String(el.className || '').substring(0, 60),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height)
          });
        }
      }
    });

    // Count by region: left sidebar vs main content
    const leftItems = visibleItems.filter(i => i.x < 300);
    const mainItems = visibleItems.filter(i => i.x >= 300);

    return {
      rootHtmlLen: root?.innerHTML?.length || 0,
      visibleText: allText.substring(0, 1500),
      leftSidebarItems: leftItems.slice(0, 30),
      mainContentItems: mainItems.slice(0, 20),
      totalVisible: visibleItems.length,
    };
  });

  console.log('Root HTML length:', mainState.rootHtmlLen);
  console.log('Total visible items:', mainState.totalVisible);
  console.log('\nLeft sidebar items (first 20):');
  mainState.leftSidebarItems.slice(0, 20).forEach((item, i) => 
    console.log(`  ${i}: "${item.text}" at (${item.x},${item.y}) ${item.w}x${item.h}`)
  );
  console.log('\nMain content items (first 10):');
  mainState.mainContentItems.slice(0, 10).forEach((item, i) => 
    console.log(`  ${i}: "${item.text}" at (${item.x},${item.y})`)
  );

  // ==================== SESSIONS CHECK ====================
  console.log('\n=== Phase 3: Sessions in sidebar ===');
  
  const sessions = await page.evaluate(() => {
    const items = [];
    // Try multiple selectors for session items
    document.querySelectorAll('a, button, [role="button"], [class*="session"], [class*="Session"], [class*="item"], [class*="row"]').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.x < 350 && rect.width > 50 && rect.height > 15 && rect.y > 30) {
        const text = el.textContent.trim();
        if (text.length > 3 && text.length < 200) {
          items.push({
            text: text.substring(0, 100),
            tag: el.tagName,
            cls: String(el.className || '').substring(0, 80),
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2),
            w: Math.round(rect.width),
            h: Math.round(rect.height)
          });
        }
      }
    });
    // Remove duplicates (parent + child might both match)
    const unique = [];
    const seen = new Set();
    for (const item of items) {
      const key = `${item.y}-${item.text.substring(0, 20)}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
    }
    return unique;
  });
  
  console.log(`Found ${sessions.length} session items in sidebar:`);
  sessions.slice(0, 25).forEach((s, i) => 
    console.log(`  ${i}: "${s.text}" [${s.tag}] y=${s.y} ${s.w}x${s.h}`)
  );

  // ==================== CLICK A SESSION ====================
  console.log('\n=== Phase 4: Click a session to load messages ===');
  
  if (sessions.length > 0) {
    // Pick a session that's not a subagent (look for ones without "subagent" or "@" in title)
    const mainSessions = sessions.filter(s => !s.text.includes('subagent') && !s.text.includes('@'));
    const target = mainSessions[0] || sessions[0];
    
    console.log(`  Clicking: "${target.text}" at (${target.x}, ${target.y})...`);
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(3000);
    
    await page.screenshot({ path: '/tmp/qa-screenshots/31-session-messages.png' });
    console.log('Screenshot: 31-session-messages.png');

    // Analyze messages area
    const msgState = await page.evaluate(() => {
      const rightSide = [];
      document.querySelectorAll('*').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.x >= 300 && rect.width > 50 && rect.height > 10 && el.children.length === 0) {
          const text = el.textContent?.trim();
          if (text && text.length > 5) {
            rightSide.push({
              text: text.substring(0, 120),
              tag: el.tagName,
              y: Math.round(rect.y)
            });
          }
        }
      });
      
      // Check for message bubbles
      const msgBubbles = document.querySelectorAll('[class*="message"], [class*="bubble"], [class*="chat-msg"]');
      const codeBlocks = document.querySelectorAll('pre, code');
      
      return {
        rightSideItems: rightSide.slice(0, 30),
        messageBubbles: msgBubbles.length,
        codeBlocks: codeBlocks.length,
        bodyText: document.body.innerText.substring(300, 1500)
      };
    });
    
    console.log('Message bubbles:', msgState.messageBubbles);
    console.log('Code blocks:', msgState.codeBlocks);
    console.log('Right-side items (first 15):');
    msgState.rightSideItems.slice(0, 15).forEach((item, i) => 
      console.log(`  ${i}: [${item.tag}] y=${item.y} "${item.text}"`)
    );
  }

  // ==================== FILE CHANGES PANEL ====================
  console.log('\n=== Phase 5: File Changes / All Files tab ===');
  
  // Look for all tabs/buttons
  const allTabs = await page.evaluate(() => {
    const tabs = [];
    document.querySelectorAll('button, [role="tab"]').forEach(el => {
      const rect = el.getBoundingClientRect();
      const text = el.textContent.trim();
      if (text.length > 0 && text.length < 50 && rect.width > 0 && rect.height > 0) {
        tabs.push({
          text,
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          cls: String(el.className || '').substring(0, 80)
        });
      }
    });
    return tabs;
  });
  
  const fileTabs = allTabs.filter(t => 
    t.text.toLowerCase().includes('file') || 
    t.text.toLowerCase().includes('change') ||
    t.text === 'All Files' || t.text === 'Changed'
  );
  
  console.log('All tabs/buttons:', allTabs.length);
  console.log('File-related tabs:', fileTabs.length);
  fileTabs.forEach(t => console.log(`  "${t.text}" at (${t.x}, ${t.y}) cls=${t.cls}`));
  
  // Also show ALL tabs for debugging
  console.log('All tabs:');
  allTabs.slice(0, 30).forEach(t => console.log(`  "${t.text}" at (${t.x}, ${t.y})`));

  if (fileTabs.length > 0) {
    const allFilesTab = fileTabs.find(t => t.text.includes('All')) || fileTabs[0];
    console.log(`\n  Clicking: "${allFilesTab.text}"...`);
    await page.mouse.click(allFilesTab.x, allFilesTab.y);
    await page.waitForTimeout(2000);
    
    await page.screenshot({ path: '/tmp/qa-screenshots/32-all-files.png' });
    console.log('Screenshot: 32-all-files.png');
    
    // Check for "No files" text
    const filesCheck = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasNoFiles: text.includes('No files') || text.includes('No file'),
        fileListItems: document.querySelectorAll('[class*="file-list"], [class*="tree"], [class*="FileTree"]').length,
        bodySnippet: text.substring(0, 500)
      };
    });
    console.log('Has "No files" text:', filesCheck.hasNoFiles);
    console.log('File list items:', filesCheck.fileListItems);
  }

  // ==================== SSE / STREAMING CHECK ====================
  console.log('\n=== Phase 6: SSE endpoint check ===');
  
  const sseCheck = await page.evaluate(async () => {
    const dir = encodeURIComponent('/home/gyugo/.winter/workspace');
    try {
      const resp = await fetch(`/global/event?directory=${dir}`, {
        headers: { 'Accept': 'text/event-stream' }
      });
      return {
        status: resp.status,
        contentType: resp.headers.get('content-type'),
        ok: resp.ok
      };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log('SSE endpoint:', JSON.stringify(sseCheck));

  // ==================== FINAL SUMMARY ====================
  console.log('\n\n==================== FINAL QA REPORT ====================');
  
  console.log(`\n[CONSOLE ERRORS] (${consoleErrors.length}):`);
  consoleErrors.forEach(e => console.log(`  [${e.type}] ${e.text.substring(0, 300)}`));
  if (consoleErrors.length === 0) console.log('  NONE');

  console.log(`\n[NETWORK ERRORS] (${networkErrors.length}):`);
  networkErrors.forEach(e => console.log(`  ${e.url} — ${e.failure}`));
  if (networkErrors.length === 0) console.log('  NONE');

  console.log(`\n[API CALLS] (${apiCalls.length}):`);
  apiCalls.forEach(c => console.log(`  [${c.status}] ${c.url.substring(0, 120)}`));

  console.log(`\n[CONSOLE LOGS] (${consoleLogs.length}, first 15):`);
  consoleLogs.slice(0, 15).forEach(l => console.log(`  [${l.type}] ${l.text.substring(0, 200)}`));

  await browser.close();
  console.log('\n=== QA COMPLETE ===');
})();
