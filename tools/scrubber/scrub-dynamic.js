// tools/scrubber/scrub-dynamic.js
/* eslint-disable */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'scrubber.config.json'), 'utf8'));
const OUT_DIR = path.resolve(__dirname, cfg.reportOutDir || './out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function isoNow() { return new Date().toISOString(); }

function toCssSelector(el) {
  // compact selector for reporting (best-effort)
  const id = el.id ? `#${el.id}` : '';
  const cls = (el.className && typeof el.className === 'string')
    ? '.' + el.className.trim().split(/\s+/).slice(0,3).join('.') : '';
  return (el.tagName ? el.tagName.toLowerCase() : 'node') + id + cls;
}

async function collectClickables(page) {
  // Buttons, links, and elements acting as buttons
  const handles = await page.$$(`button, [role="button"], a, [onclick]`);
  const clickables = [];
  for (const h of handles) {
    const info = await h.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || '').trim().slice(0, 120),
        aria: el.getAttribute('aria-label'),
        role: el.getAttribute('role'),
        href: (el.getAttribute('href') || '').trim(),
        id: el.id || null,
        className: el.className || null,
        visible: !!(rect.width && rect.height),
        selector: (function s(e){
          // minimal path
          if (e.id) return e.tagName.toLowerCase() + '#' + e.id;
          const idx = Array.from(e.parentNode?.children || []).indexOf(e) + 1;
          const parent = e.parentElement ? s(e.parentElement) : e.tagName.toLowerCase();
          return parent + '>' + e.tagName.toLowerCase() + `:nth-child(${idx})`;
        })(el)
      };
    });
    // Ignore invisible or pure anchor with empty/fragment href and no obvious handler; still test though.
    clickables.push({ handle: h, info });
  }
  return clickables;
}

function classifyOutcome(out) {
  // Heuristics for "actionless"
  const hadNav = out.afterUrl && out.afterUrl !== out.beforeUrl;
  const hadNet = out.net.requests.length || out.net.failed.length || out.net.error4xx5xx.length;
  const hadDom = (out.dom.added + out.dom.removed + out.dom.attr) > 0;
  const hadErrors = out.console.errors.length || out.pageErrors.length;

  if (hadErrors) return 'JS_ERROR';
  if (out.net.error4xx5xx.length) return 'BROKEN_ENDPOINT';
  if (!hadNav && !hadNet && !hadDom) return 'ACTIONLESS';
  if (out.net.blockedMutations.length) return 'MUTATION_ATTEMPT_BLOCKED';
  return 'OK';
}

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    javaScriptEnabled: true,
    serviceWorkers: cfg.serviceWorkers === 'block' ? 'block' : 'allow'
  });
  const page = await context.newPage();

  // Intercept & block mutating methods (dry-run)
  await page.route('**/*', async (route) => {
    const req = route.request();
    const method = req.method();
    if (cfg.dryRun && cfg.blockMethods.includes(method)) {
      // fulfill with 200 stub (recorded below)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ stub: true }) });
    }
    return route.continue();
  });

  const visited = new Set();
  const q = [cfg.startUrl];
  const results = [];

  // Helpers to harvest links for crawling
  async function harvestLinks() {
    const urls = await page.$$eval('a[href]', (as) =>
      as.map(a => a.getAttribute('href')).filter(Boolean));
    const base = new URL(page.url());
    const next = [];
    for (const u of urls) {
      try {
        const abs = new URL(u, base).href;
        if (new RegExp(cfg.allowedHostPattern).test(abs)) next.push(abs);
      } catch (_) { /* ignore */ }
    }
    return Array.from(new Set(next));
  }

  while (q.length) {
    const url = q.shift();
    const depth = (url.match(/\//g) || []).length - (cfg.startUrl.match(/\//g) || []).length;
    if (depth > cfg.maxDepth) continue;
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await sleep(200); // allow hydration

      // Gather clickables on this page
      const clickables = await collectClickables(page);

      for (let i = 0; i < clickables.length; i++) {
        const { handle, info } = clickables[i];

        // Attach observers
        const net = { requests: [], failed: [], error4xx5xx: [], blockedMutations: [] };
        const consoleErrors = [];
        const pageErrors = [];

        const onReqFailed = (req) => net.failed.push({ url: req.url(), method: req.method(), failure: req.failure()?.errorText });
        const onResp = (resp) => {
          const st = resp.status();
          if (st >= 400) net.error4xx5xx.push({ url: resp.url(), status: st });
        };
        const onConsole = (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); };
        const onPageError = (err) => pageErrors.push(String(err));

        page.on('requestfailed', onReqFailed);
        page.on('response', onResp);
        page.on('console', onConsole);
        page.on('pageerror', onPageError);

        // Track mutating requests we blocked
        const preReq = page._onRoute || null; // not public; we rely on response scan + dryRun
        // Mutation observer script in the page
        await page.addInitScript(() => {
          if (window.__scrubObserver) return;
          window.__scrubChanges = { added: 0, removed: 0, attr: 0 };
          window.__scrubObserver = new MutationObserver((ms) => {
            for (const m of ms) {
              if (m.type === 'childList') { window.__scrubChanges.added += m.addedNodes.length; window.__scrubChanges.removed += m.removedNodes.length; }
              if (m.type === 'attributes') { window.__scrubChanges.attr += 1; }
            }
          });
          window.__scrubObserver.observe(document.body, { childList: true, subtree: true, attributes: true });
        });

        const beforeUrl = page.url();

        // Try clicking (ignore element detached errors)
        let clickError = null;
        try {
          await handle.scrollIntoViewIfNeeded();
          await handle.click({ trial: false, timeout: 2000 });
          await page.waitForTimeout(cfg.clickTimeoutMs || 1500);
        } catch (e) {
          clickError = String(e);
          consoleErrors.push(clickError);
        }

        // Pull DOM change summary
        const dom = await page.evaluate(() => window.__scrubChanges || { added: 0, removed: 0, attr: 0 });
        const afterUrl = page.url();

        // Check if any mutating request was blocked (infer via method + 200 stub seen as body {"stub":true})
        // Simpler: look at failed/4xx/5xx we captured; for blocked we can't inspect body here.
        // We'll mark blocked if NO 4xx/5xx but dryRun and DOM changed minimally and we see any response with status 200 to a mutating endpoint in logs (not trivial); omit here.

        const out = {
          ts: isoNow(),
          pageUrl: url,
          beforeUrl,
          afterUrl,
          element: {
            selector: info.selector,
            tag: info.tag,
            label: info.aria || info.text || info.href || toCssSelector(info),
            role: info.role,
            href: info.href || null
          },
          net,
          console: { errors: consoleErrors },
          pageErrors,
          dom
        };

        const classification = classifyOutcome(out);
        out.classification = classification;

        results.push(out);

        // cleanup listeners for next click
        page.off('requestfailed', onReqFailed);
        page.off('response', onResp);
        page.off('console', onConsole);
        page.off('pageerror', onPageError);
      }

      // enqueue more links
      const more = await harvestLinks();
      more.forEach(u => { if (!visited.has(u)) q.push(u); });

    } catch (e) {
      results.push({ ts: isoNow(), pageUrl: url, classification: 'NAV_ERROR', error: String(e) });
    }
  }

  // Write report
  const jsonPath = path.join(OUT_DIR, 'dynamic-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));

  // Build markdown focusing on actionless buttons
  const actionless = results.filter(r => r.classification === 'ACTIONLESS');
  const broken = results.filter(r => r.classification === 'BROKEN_ENDPOINT' || r.classification === 'JS_ERROR');

  let md = `# UI Action Scrub Report (Dynamic)\n\nGenerated: ${isoNow()}\n\n## Summary\n- Pages scanned: ${visited.size}\n- Clickables tested: ${results.filter(r=>r.element).length}\n- Actionless: ${actionless.length}\n- Broken (4xx/5xx or JS errors): ${broken.length}\n\n`;

  const sect = (title, arr) => {
    md += `\n## ${title}\n\n| Page | Element | Href/Label | Notes |\n|---|---|---|---|\n`;
    for (const r of arr) {
      md += `| ${r.pageUrl} | \`${r.element?.selector || ''}\` | ${r.element?.href || r.element?.label || ''} | ${r.classification}${r.console?.errors?.length ? ' · console err' : ''} |\n`;
    }
  };
  sect('Actionless', actionless);
  sect('Broken / JS Errors', broken);

  fs.writeFileSync(path.join(OUT_DIR, 'dynamic-report.md'), md);

  await browser.close();
}

run().catch(e => { console.error(e); process.exit(1); });