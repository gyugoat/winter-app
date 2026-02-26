const { chromium } = require('playwright');

(async () => {
  const results = {
    consoleErrors: [],
    consoleLogs: [],
    networkErrors: [],
    screenshots: [],
    findings: []
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  // Collect console messages
  page.on('console', msg => {
    const entry = { type: msg.type(), text: msg.text() };
    if (msg.type() === 'error') {
      results.consoleErrors.push(entry);
    } else {
      results.consoleLogs.push(entry);
    }
  });

  // Collect page errors (uncaught exceptions)
  page.on('pageerror', error => {
    results.consoleErrors.push({ type: 'pageerror', text: error.message });
  });

  // Collect failed network requests
  page.on('requestfailed', request => {
    results.networkErrors.push({
      url: request.url(),
      failure: request.failure()?.errorText || 'unknown'
    });
  });

  // ========== STEP 1: Initial page load ==========
  console.log('\n=== STEP 1: Loading page ===');
  try {
    await page.goto('http://127.0.0.1:8890/', { waitUntil: 'networkidle', timeout: 15000 });
    console.log('Page loaded successfully');
    results.findings.push({ step: 'page_load', status: 'OK', detail: 'Page loaded with networkidle' });
  } catch (e) {
    console.log('Page load issue:', e.message);
    // Try with domcontentloaded instead
    try {
      await page.goto('http://127.0.0.1:8890/', { waitUntil: 'domcontentloaded', timeout: 10000 });
      results.findings.push({ step: 'page_load', status: 'PARTIAL', detail: 'Loaded with domcontentloaded, networkidle timed out' });
    } catch (e2) {
      results.findings.push({ step: 'page_load', status: 'FAIL', detail: e2.message });
    }
  }

  // Wait a bit for React hydration and API calls
  await page.waitForTimeout(3000);

  // Take initial screenshot
  await page.screenshot({ path: '/tmp/qa-screenshots/01-initial-load.png', fullPage: false });
  results.screenshots.push('01-initial-load.png');
  console.log('Screenshot: 01-initial-load.png');

  // ========== STEP 2: Check for blank screen ==========
  console.log('\n=== STEP 2: Blank screen check ===');
  const bodyHTML = await page.evaluate(() => document.body.innerHTML.length);
  const visibleText = await page.evaluate(() => document.body.innerText.trim().length);
  console.log(`Body HTML length: ${bodyHTML}, Visible text length: ${visibleText}`);
  if (bodyHTML < 100) {
    results.findings.push({ step: 'blank_screen', status: 'FAIL', detail: `Body HTML only ${bodyHTML} chars - likely blank` });
  } else if (visibleText < 10) {
    results.findings.push({ step: 'blank_screen', status: 'WARN', detail: `HTML present (${bodyHTML}) but very little visible text (${visibleText})` });
  } else {
    results.findings.push({ step: 'blank_screen', status: 'OK', detail: `HTML: ${bodyHTML} chars, Visible text: ${visibleText} chars` });
  }

  // ========== STEP 3: Check sidebar / sessions ==========
  console.log('\n=== STEP 3: Checking sidebar and sessions ===');
  
  // Try to find sidebar elements - look for various possible selectors
  const sidebarSelectors = [
    '[data-testid="sidebar"]',
    '.sidebar',
    'nav',
    'aside',
    '[class*="sidebar"]',
    '[class*="Sidebar"]',
    '[class*="panel"]',
    '[class*="session"]',
    '[class*="Session"]',
  ];
  
  for (const sel of sidebarSelectors) {
    const count = await page.locator(sel).count();
    if (count > 0) {
      console.log(`  Found ${count} element(s) matching: ${sel}`);
    }
  }

  // Look for session items in sidebar
  const sessionSelectors = [
    '[class*="session"]',
    '[class*="Session"]',
    '[data-testid*="session"]',
    '[class*="conversation"]',
    '[class*="chat-item"]',
    'nav a',
    'aside a',
    'aside button',
  ];

  let sessionElements = null;
  let sessionCount = 0;
  for (const sel of sessionSelectors) {
    const count = await page.locator(sel).count();
    if (count > 2) {
      console.log(`  Session candidates: ${count} elements matching: ${sel}`);
      sessionElements = sel;
      sessionCount = count;
    }
  }

  // Also try to count all clickable items in any sidebar-like area
  const allLinks = await page.locator('a, button').count();
  console.log(`  Total links/buttons on page: ${allLinks}`);

  // Get page structure overview
  const structure = await page.evaluate(() => {
    const root = document.getElementById('root') || document.getElementById('app') || document.body.firstElementChild;
    if (!root) return 'No root element found';
    
    function describe(el, depth = 0) {
      if (depth > 3 || !el) return '';
      const tag = el.tagName?.toLowerCase() || '?';
      const cls = el.className ? `.${String(el.className).split(' ').slice(0, 2).join('.')}` : '';
      const id = el.id ? `#${el.id}` : '';
      const children = Array.from(el.children || []).map(c => describe(c, depth + 1)).filter(Boolean);
      const childCount = el.children?.length || 0;
      return `${'  '.repeat(depth)}<${tag}${id}${cls}> (${childCount} children)\n${children.join('')}`;
    }
    return describe(root);
  });
  console.log('\nPage structure (top 3 levels):');
  console.log(structure);

  if (sessionCount >= 5) {
    results.findings.push({ step: 'sidebar_sessions', status: 'OK', detail: `Found ${sessionCount} session elements (${sessionElements})` });
  } else {
    results.findings.push({ step: 'sidebar_sessions', status: 'INVESTIGATE', detail: `Only ${sessionCount} session-like elements found. Needs manual inspection.` });
  }

  await page.screenshot({ path: '/tmp/qa-screenshots/02-structure-check.png', fullPage: false });
  results.screenshots.push('02-structure-check.png');

  // ========== STEP 4: Try clicking a session ==========
  console.log('\n=== STEP 4: Click a session ===');
  
  // First, let's see what's actually visible with text content
  const textElements = await page.evaluate(() => {
    const elements = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (text.length > 3 && text.length < 200) {
        const parent = node.parentElement;
        const tag = parent?.tagName?.toLowerCase();
        const cls = parent?.className ? String(parent.className).substring(0, 50) : '';
        elements.push({ text: text.substring(0, 80), tag, cls });
      }
    }
    return elements.slice(0, 40);
  });
  console.log('\nVisible text elements (first 40):');
  textElements.forEach((el, i) => console.log(`  ${i}: [${el.tag}.${el.cls}] "${el.text}"`));

  // Try to click a session-like element
  let clicked = false;
  
  // Try clicking elements that look like session items
  try {
    // Look for elements containing session-like text in the sidebar area
    const clickableItems = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll('a, button, [role="button"], [onclick], [class*="item"], [class*="session"], [class*="Session"]').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.x < 400) { // Left side = sidebar
          items.push({
            tag: el.tagName,
            text: el.textContent.trim().substring(0, 80),
            cls: String(el.className || '').substring(0, 60),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height)
          });
        }
      });
      return items;
    });
    
    console.log('\nClickable items in left sidebar area:');
    clickableItems.forEach((item, i) => console.log(`  ${i}: [${item.tag}.${item.cls}] "${item.text}" at (${item.x},${item.y}) ${item.w}x${item.h}`));

    // Click the first substantial item in the sidebar
    if (clickableItems.length > 0) {
      const target = clickableItems.find(it => it.text.length > 5) || clickableItems[0];
      console.log(`\nClicking: "${target.text}" at (${target.x + target.w/2}, ${target.y + target.h/2})`);
      await page.mouse.click(target.x + target.w / 2, target.y + target.h / 2);
      await page.waitForTimeout(2000);
      clicked = true;
      
      await page.screenshot({ path: '/tmp/qa-screenshots/03-after-session-click.png', fullPage: false });
      results.screenshots.push('03-after-session-click.png');
      results.findings.push({ step: 'session_click', status: 'OK', detail: `Clicked "${target.text}", screenshot taken` });
    } else {
      results.findings.push({ step: 'session_click', status: 'WARN', detail: 'No clickable sidebar items found' });
    }
  } catch (e) {
    console.log('Click error:', e.message);
    results.findings.push({ step: 'session_click', status: 'FAIL', detail: e.message });
  }

  // ========== STEP 5: Check chat messages area ==========
  console.log('\n=== STEP 5: Check chat/messages area ===');
  const messageSelectors = [
    '[class*="message"]',
    '[class*="Message"]',
    '[class*="chat"]',
    '[class*="Chat"]',
    '[class*="content"]',
    '[role="article"]',
    'pre', 'code',
    '[class*="markdown"]',
    '[class*="Markdown"]',
  ];
  
  for (const sel of messageSelectors) {
    const count = await page.locator(sel).count();
    if (count > 0) {
      console.log(`  Found ${count} element(s) matching: ${sel}`);
    }
  }

  // ========== STEP 6: Check File Changes / All Files ==========
  console.log('\n=== STEP 6: Check File Changes / All Files tab ===');
  
  // Look for tab-like elements mentioning "files" or "changes"
  const fileTabTexts = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('button, [role="tab"], a, [class*="tab"], [class*="Tab"]').forEach(el => {
      const text = el.textContent.trim().toLowerCase();
      if (text.includes('file') || text.includes('change') || text.includes('all')) {
        results.push({
          text: el.textContent.trim(),
          tag: el.tagName,
          cls: String(el.className || '').substring(0, 60),
          rect: el.getBoundingClientRect()
        });
      }
    });
    return results;
  });
  
  console.log('File/Changes tab elements:');
  fileTabTexts.forEach((el, i) => console.log(`  ${i}: [${el.tag}] "${el.text}" cls=${el.cls}`));

  if (fileTabTexts.length > 0) {
    // Try clicking "All Files" tab
    const allFilesTab = fileTabTexts.find(t => t.text.toLowerCase().includes('all file'));
    if (allFilesTab) {
      console.log(`Clicking "All Files" tab at (${allFilesTab.rect.x + allFilesTab.rect.width/2}, ${allFilesTab.rect.y + allFilesTab.rect.height/2})`);
      await page.mouse.click(
        allFilesTab.rect.x + allFilesTab.rect.width / 2,
        allFilesTab.rect.y + allFilesTab.rect.height / 2
      );
      await page.waitForTimeout(2000);
      await page.screenshot({ path: '/tmp/qa-screenshots/04-all-files-tab.png', fullPage: false });
      results.screenshots.push('04-all-files-tab.png');
      
      // Check if "No files" is showing
      const noFilesText = await page.evaluate(() => {
        return document.body.innerText.includes('No files') || document.body.innerText.includes('No file');
      });
      if (noFilesText) {
        results.findings.push({ step: 'all_files_tab', status: 'FAIL', detail: '"No files" text visible - workspace files not loading' });
      } else {
        results.findings.push({ step: 'all_files_tab', status: 'OK', detail: 'All Files tab accessible, no "No files" message' });
      }
    } else {
      // Try clicking any file-related tab
      const target = fileTabTexts[0];
      console.log(`Clicking file tab: "${target.text}"`);
      await page.mouse.click(target.rect.x + target.rect.width / 2, target.rect.y + target.rect.height / 2);
      await page.waitForTimeout(2000);
      await page.screenshot({ path: '/tmp/qa-screenshots/04-file-tab.png', fullPage: false });
      results.screenshots.push('04-file-tab.png');
      results.findings.push({ step: 'all_files_tab', status: 'PARTIAL', detail: `Clicked "${target.text}" but couldn't find "All Files" specifically` });
    }
  } else {
    results.findings.push({ step: 'all_files_tab', status: 'NOT_FOUND', detail: 'No file/changes tab elements found' });
    await page.screenshot({ path: '/tmp/qa-screenshots/04-no-file-tab.png', fullPage: false });
    results.screenshots.push('04-no-file-tab.png');
  }

  // ========== STEP 7: Final full-page screenshot ==========
  console.log('\n=== STEP 7: Final screenshot ===');
  await page.screenshot({ path: '/tmp/qa-screenshots/05-final-state.png', fullPage: false });
  results.screenshots.push('05-final-state.png');

  // ========== STEP 8: Check for specific error patterns ==========
  console.log('\n=== STEP 8: API/Network analysis ===');
  
  // Check API responses
  const apiCheck = await page.evaluate(async () => {
    const results = {};
    
    // Test sessions API
    try {
      const resp = await fetch('/api/session.list');
      results.sessionList = { status: resp.status, ok: resp.ok };
      if (resp.ok) {
        const data = await resp.json();
        results.sessionList.count = Array.isArray(data) ? data.length : (data?.sessions?.length || 'not array');
      }
    } catch (e) {
      results.sessionList = { error: e.message };
    }

    return results;
  });
  console.log('API check results:', JSON.stringify(apiCheck, null, 2));
  results.findings.push({ step: 'api_check', status: apiCheck.sessionList?.ok ? 'OK' : 'FAIL', detail: JSON.stringify(apiCheck) });

  // ========== SUMMARY ==========
  console.log('\n\n========== QA RESULTS SUMMARY ==========');
  console.log(`\nConsole Errors (${results.consoleErrors.length}):`);
  results.consoleErrors.forEach(e => console.log(`  [${e.type}] ${e.text.substring(0, 200)}`));
  
  console.log(`\nNetwork Errors (${results.networkErrors.length}):`);
  results.networkErrors.forEach(e => console.log(`  ${e.url} — ${e.failure}`));
  
  console.log(`\nFindings:`);
  results.findings.forEach(f => console.log(`  [${f.status}] ${f.step}: ${f.detail}`));
  
  console.log(`\nScreenshots: ${results.screenshots.join(', ')}`);
  
  console.log(`\nConsole Logs (${results.consoleLogs.length} total, showing first 20):`);
  results.consoleLogs.slice(0, 20).forEach(l => console.log(`  [${l.type}] ${l.text.substring(0, 150)}`));

  await browser.close();
  console.log('\n=== QA test complete ===');
})();
