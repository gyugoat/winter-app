const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
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

  // Track API calls
  page.on('response', response => {
    const url = response.url();
    if (url.includes('/session') || url.includes('/event') || url.includes('/global/') ||
        url.includes('/file') || url.includes('/path') || url.includes('/config') ||
        url.includes('/api/')) {
      apiCalls.push({
        url: url.replace('http://127.0.0.1:8890', ''),
        status: response.status(),
        type: response.headers()['content-type']?.substring(0, 60) || ''
      });
    }
  });

  console.log('=== Loading page ===');
  await page.goto('http://127.0.0.1:8890/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  
  // Wait longer for the React app to initialize
  console.log('Waiting 5s for React hydration...');
  await page.waitForTimeout(5000);

  await page.screenshot({ path: '/tmp/qa-screenshots/10-after-5s.png' });
  console.log('Screenshot: 10-after-5s.png');

  // Check what's on screen
  const pageState = await page.evaluate(() => {
    const root = document.getElementById('root');
    const html = root?.innerHTML || '';
    const classes = root?.firstElementChild?.className || '';
    const allClasses = [];
    document.querySelectorAll('[class]').forEach(el => {
      const cls = String(el.className);
      if (cls.length > 2 && cls.length < 100) allClasses.push(cls.substring(0, 80));
    });
    
    // Check for splash screen
    const splash = document.querySelector('.splash');
    const hasSplash = !!splash;
    
    // Check for main app content
    const mainContent = html.length;
    
    return {
      rootHtmlLength: mainContent,
      rootFirstChildClass: classes,
      hasSplash,
      uniqueClasses: [...new Set(allClasses)].slice(0, 30),
      visibleText: document.body.innerText.trim().substring(0, 500)
    };
  });
  
  console.log('\nPage state after 5s:');
  console.log('  Root HTML length:', pageState.rootHtmlLength);
  console.log('  Root first child class:', pageState.rootFirstChildClass);
  console.log('  Has splash:', pageState.hasSplash);
  console.log('  Visible text:', pageState.visibleText);
  console.log('  Unique classes (first 30):', pageState.uniqueClasses);

  // Wait even longer — maybe the splash has a timeout
  console.log('\nWaiting another 10s...');
  await page.waitForTimeout(10000);
  
  await page.screenshot({ path: '/tmp/qa-screenshots/11-after-15s.png' });
  console.log('Screenshot: 11-after-15s.png');

  const pageState2 = await page.evaluate(() => {
    const root = document.getElementById('root');
    const splash = document.querySelector('.splash');
    return {
      rootHtmlLength: root?.innerHTML?.length || 0,
      hasSplash: !!splash,
      visibleText: document.body.innerText.trim().substring(0, 500),
      childCount: root?.children?.length || 0,
      firstChildTag: root?.firstElementChild?.tagName || 'none',
      firstChildClass: String(root?.firstElementChild?.className || '').substring(0, 100),
    };
  });

  console.log('\nPage state after 15s:');
  console.log('  Root HTML length:', pageState2.rootHtmlLength);
  console.log('  Has splash:', pageState2.hasSplash);
  console.log('  Child count:', pageState2.childCount);
  console.log('  First child:', pageState2.firstChildTag, pageState2.firstChildClass);
  console.log('  Visible text:', pageState2.visibleText);

  // Check if APIs are returning data through the browser
  console.log('\n=== Testing API calls from browser context ===');
  const browserApiTest = await page.evaluate(async () => {
    const results = {};
    
    // Test 1: /session with directory
    try {
      const wsDir = encodeURIComponent('/home/gyugo/.winter/workspace');
      const r1 = await fetch(`/session?directory=${wsDir}`);
      const d1 = await r1.json();
      results.session = { status: r1.status, count: Array.isArray(d1) ? d1.length : 'not array', sample: Array.isArray(d1) && d1[0] ? d1[0].title : null };
    } catch (e) {
      results.session = { error: e.message };
    }

    // Test 2: /global/health
    try {
      const r2 = await fetch(`/global/health?directory=${encodeURIComponent('/home/gyugo/.winter/workspace')}`);
      const d2 = await r2.text();
      results.health = { status: r2.status, body: d2.substring(0, 200) };
    } catch (e) {
      results.health = { error: e.message };
    }

    // Test 3: /path
    try {
      const r3 = await fetch(`/path?directory=${encodeURIComponent('/home/gyugo/.winter/workspace')}`);
      const d3 = await r3.text();
      results.path = { status: r3.status, body: d3.substring(0, 200) };
    } catch (e) {
      results.path = { error: e.message };
    }

    // Test 4: /file (list workspace files)
    try {
      const r4 = await fetch(`/file?path=${encodeURIComponent('/home/gyugo/.winter/workspace')}&directory=${encodeURIComponent('/home/gyugo/.winter/workspace')}`);
      const d4 = await r4.text();
      results.file = { status: r4.status, bodyLen: d4.length, sample: d4.substring(0, 200) };
    } catch (e) {
      results.file = { error: e.message };
    }

    // Test 5: /api/config
    try {
      const r5 = await fetch('/api/config');
      const d5 = await r5.json();
      results.config = { status: r5.status, keys: Object.keys(d5) };
    } catch (e) {
      results.config = { error: e.message };
    }

    return results;
  });

  console.log('\nBrowser API test results:');
  for (const [key, val] of Object.entries(browserApiTest)) {
    console.log(`  ${key}:`, JSON.stringify(val));
  }

  // Check console errors/logs 
  console.log('\n=== Console Errors ===');
  consoleErrors.forEach(e => console.log(`  [${e.type}] ${e.text.substring(0, 300)}`));
  if (consoleErrors.length === 0) console.log('  (none)');

  console.log('\n=== Console Logs (first 30) ===');
  consoleLogs.slice(0, 30).forEach(l => console.log(`  [${l.type}] ${l.text.substring(0, 200)}`));

  console.log('\n=== Network Errors ===');
  networkErrors.forEach(e => console.log(`  ${e.url} — ${e.failure}`));
  if (networkErrors.length === 0) console.log('  (none)');

  console.log('\n=== API Calls Made By App ===');
  apiCalls.forEach(c => console.log(`  [${c.status}] ${c.url} (${c.type})`));
  if (apiCalls.length === 0) console.log('  (none — app may not be making API calls)');

  // Try to bypass the splash screen manually
  console.log('\n=== Attempting splash bypass ===');
  const bypassResult = await page.evaluate(() => {
    // Check if there's a React state we can manipulate
    const root = document.getElementById('root');
    const fiber = root?._reactRootContainer || root?.__reactFiber$ || null;
    
    // Check for any global app state
    const windowKeys = Object.keys(window).filter(k => 
      k.startsWith('__') || k.includes('store') || k.includes('app') || k.includes('react'));
    
    return {
      hasFiber: !!fiber,
      windowKeys: windowKeys.slice(0, 20),
      localStorageKeys: Object.keys(localStorage),
      sessionStorageKeys: Object.keys(sessionStorage)
    };
  });
  console.log('Bypass analysis:', JSON.stringify(bypassResult, null, 2));

  // Final screenshot
  await page.screenshot({ path: '/tmp/qa-screenshots/12-final.png' });

  await browser.close();
  console.log('\n=== Test complete ===');
})();
