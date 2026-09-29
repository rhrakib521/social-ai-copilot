// LIVE browser test: drives the REAL extension in a REAL Chrome window via
// the DevTools protocol. Verifies on the user's screen that double-clicking a
// LinkedIn comment box opens the popover and the context badge actually read
// the post. If the badge warns, it auto-clicks it and captures the live
// diagnostics report. Run: node test/live-cdp.js (Chrome must be up with
// --remote-debugging-port=9223)

const fs = require('fs');
const path = require('path');
const DEBUG_PORT = process.env.SAIC_DEBUG_PORT || 9223;
const OUT_PNG = path.join(__dirname, 'live-screen.png');

// ── minimal CDP client over the global WebSocket (Node >= 21) ──
let ws = null;
let msgId = 0;
const pending = new Map();   // id -> {resolve, reject}
const eventHandlers = [];

function cdpSend(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('CDP timeout: ' + method));
      }
    }, 20000);
  });
}

function onEvent(fn) { eventHandlers.push(fn); }

async function evalInPage(expression, awaitPromise = false) {
  const r = await cdpSend('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise
  });
  if (r.exceptionDetails) {
    throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
  }
  return r.result && r.result.value;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  // 1. find the LinkedIn tab
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  let page = targets.find(t => t.type === 'page' && /linkedin\.com/.test(t.url));
  if (!page) {
    // open one
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?https://www.linkedin.com/feed/`, { method: 'PUT' });
    await sleep(4000);
    const again = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    page = again.find(t => t.type === 'page' && /linkedin\.com/.test(t.url));
  }
  if (!page) throw new Error('No LinkedIn tab found');
  console.log('[live] attached to tab:', page.url);

  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onclose = (ev) => console.log('[live] WebSocket closed (code ' + ev.code + ') — page navigated or tab closed');
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
    } else if (m.method) {
      for (const fn of eventHandlers) fn(m.method, m.params);
    }
  };

  const saicLogs = [];
  onEvent((method, params) => {
    if (method === 'Runtime.consoleAPICalled') {
      const args = (params.args || []).map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
      if (/SAIC/.test(args)) { saicLogs.push(args); console.log('[page console]', args.slice(0, 300)); }
    }
    if (method === 'Runtime.exceptionThrown') {
      console.log('[page exception]', JSON.stringify(params.exceptionDetails).slice(0, 300));
    }
  });

  await cdpSend('Runtime.enable');
  await cdpSend('Page.enable');

  // 2. wait until the feed has posts (user logs in if needed)
  console.log('[live] waiting for the LinkedIn feed' +
    (page.url.includes('login') || page.url === 'about:blank' ? ' — LOG IN in the Chrome window if needed' : '') + '...');
  let feedReady = false;
  const MAX_POLLS = parseInt(process.env.SAIC_WAIT_POLLS || '400', 10); // 400×3s = 20 min
  for (let i = 0; i < MAX_POLLS && !feedReady; i++) {
    try {
      const n = await evalInPage(`document.querySelectorAll('[data-testid="mainFeed"] [role="listitem"], .feed-shared-update-v2, button[aria-label="Comment"]').length`);
      if (n > 0) feedReady = true; else await sleep(3000);
    } catch (e) { await sleep(3000); }
  }
  if (!feedReady) throw new Error('feed never loaded (login timeout, ' + Math.round(MAX_POLLS * 3 / 60) + ' min)');
  console.log('[live] feed is up.');

  // 3. is the content script alive? dblclick the top-nav search input —
  // findEditableField matches plain text inputs, so a .saic-popover must appear.
  const alive = await evalInPage(`(async () => {
    const input = document.querySelector('input[placeholder*="Search" i], .search-global-typeahead input, form input[type="text"]');
    if (!input) return { ok: false, why: 'no search input found' };
    input.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 900));
    return { ok: !!document.querySelector('.saic-popover') };
  })()`, true);
  console.log('[live] content script alive (popover via dblclick on search box):', JSON.stringify(alive));

  // 4. open a real comment editor: TRUSTED click on a Comment button, with
  // retries (SDUI React ignores synthetic clicks; layout can shift between
  // locate and click, so coords are re-read right before each press).
  let editorFound = null;
  for (let attempt = 0; attempt < 3 && !editorFound; attempt++) {
    const coords = await evalInPage(`(() => {
      const btns = Array.from(document.querySelectorAll('button[aria-label="Comment"]'));
      const btn = (btns.find(b => /\\d/.test(b.textContent || '')) || btns[0]);
      if (!btn) return null;
      btn.scrollIntoView({ block: 'center' });
      return { x: 0, y: 0, idx: btns.indexOf(btn) };
    })()`);
    if (!coords) throw new Error('no Comment button found on the feed');
    await sleep(900); // let scroll + lazy images settle
    const rc = await evalInPage(`(() => {
      const btns = Array.from(document.querySelectorAll('button[aria-label="Comment"]'));
      const btn = btns[${coords.idx}] || btns[0];
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    console.log('[live] trusted Comment click attempt ' + (attempt + 1) + ' at', JSON.stringify(rc));
    await cdpSend('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rc.x, y: rc.y });
    await sleep(150);
    await cdpSend('Input.dispatchMouseEvent', { type: 'mousePressed', x: rc.x, y: rc.y, button: 'left', clickCount: 1 });
    await cdpSend('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rc.x, y: rc.y, button: 'left', clickCount: 1 });
    await sleep(3000);
    editorFound = await evalInPage(`(() => {
      function findAllIn(root, sel, acc) {
        acc.push(...root.querySelectorAll(sel));
        root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) findAllIn(el.shadowRoot, sel, acc); });
        return acc;
      }
      const eds = findAllIn(document, '[contenteditable="true"], [role="textbox"]', [])
        .filter(e => !e.closest('.saic-popover') && e.getAttribute('aria-label') !== 'Search');
      if (!eds.length) return null;
      const e = eds[0];
      const post = e.closest('[data-testid="mainFeed"] [role="listitem"], .feed-shared-update-v2');
      const txt = post ? (post.querySelector('[data-testid="expandable-text-box"], .update-components-text') || post).textContent : '';
      return { cls: String(e.className).slice(0, 60), inPost: !!post,
        postPreview: txt.replace(/\\s+/g, ' ').trim().slice(0, 80) };
    })()`);
    if (!editorFound) console.log('[live] no editor after attempt ' + (attempt + 1) + ', retrying…');
  }
  if (!editorFound) throw new Error('no comment editor appeared after 3 trusted clicks');
  console.log('[live] comment editor open:', JSON.stringify(editorFound));

  // 5. double-click the editor (our own listener takes synthetic events)
  const opened = await evalInPage(`(async () => {
    function findAllIn(root, sel, acc) {
      acc.push(...root.querySelectorAll(sel));
      root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) findAllIn(el.shadowRoot, sel, acc); });
      return acc;
    }
    const eds = findAllIn(document, '[contenteditable="true"], [role="textbox"]', [])
      .filter(e => !e.closest('.saic-popover') && e.getAttribute('aria-label') !== 'Search');
    if (!eds.length) return { ok: false, why: 'editor vanished' };
    const editor = eds[0];
    editor.scrollIntoView({ block: 'center' });
    await new Promise(r => setTimeout(r, 600));
    editor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 1500));
    const popover = document.querySelector('.saic-popover');
    return { ok: !!popover, editorClass: String(editor.className).slice(0, 60) };
  })()`, true);
  console.log('[live] popover after dblclick:', JSON.stringify(opened));
  if (!opened || !opened.ok) throw new Error('popover did not open: ' + JSON.stringify(opened));

  // 6. THE VERDICT — what does the badge say?
  const badge = await evalInPage(`(document.querySelector('.saic-context-badge') || {}).textContent || '(no badge)'`);
  console.log('\n[live] ★ BADGE: ' + badge + '\n');

  // 7. screenshot for the user
  await sleep(600);
  const shot = await cdpSend('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT_PNG, Buffer.from(shot.data, 'base64'));
  console.log('[live] screenshot saved:', OUT_PNG);

  // 8. if the badge warns, auto-click it and capture the diagnostics report
  if (/⚠|No post|could not/.test(badge)) {
    console.log('[live] badge is warning — clicking it to pull diagnostics...');
    await evalInPage(`(document.querySelector('.saic-context-badge')).click()`);
    await sleep(800);
    const report = await evalInPage(`(document.querySelector('#saic-diag-overlay pre') || {}).textContent || '(no overlay)'`);
    console.log('\n===== LIVE DIAGNOSTICS REPORT =====\n' + report + '\n==================================');
    const shot2 = await cdpSend('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, 'live-diagnostics.png'), Buffer.from(shot2.data, 'base64'));
  }

  console.log('\n[live] captured [SAIC] console lines:', saicLogs.length);
  console.log('[live] DONE. Badge verdict is above.');
  process.exit(0);
}

main().catch(e => { console.error('[live] ERROR:', e.message); process.exit(1); });
