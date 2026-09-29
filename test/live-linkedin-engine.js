// LIVE LinkedIn diagnostics (Phase A): drives the REAL logged-in feed to
// capture ground truth the engine fixes must match:
//   1. What actually scrolls the 2026 feed (window vs inner overflow container)
//   2. Which [role=listitem] entries are real posts vs feed modules
//   3. What clicking the comment button produces (composer markup + buttons)
//   4. What the @-mention dropdown looks like (portal diff + a11y announcer)
// Writes test/live-linkedin-diag.json + screenshots. No product code involved.
//
// Run: node test/live-linkedin-engine.js
// Needs: node test/live-launch.js first, and a LinkedIn login in that Chrome.
// Exit codes: 0 ok · 2 error · 3 login required

const fs = require('fs');
const path = require('path');
const PORT = process.env.SAIC_DEBUG_PORT || 9223;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let ws = null, msgId = 0;
const pending = new Map();
const diag = { url: '', scroll: null, census: null, composer: null, mention: null, consoleLines: [] };

function cdpSend(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)); } }, 30000);
  });
}
async function evalInPage(expression, awaitPromise = false) {
  const r = await cdpSend('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 300));
  return r.result && r.result.value;
}

async function attach(matchRe) {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  let page = targets.find(t => t.type === 'page' && new RegExp(matchRe).test(t.url));
  if (!page) {
    await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
    await sleep(1200);
    const again = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = again.find(t => t.type === 'page' && /about:blank/.test(t.url)) || again[again.length - 1];
  }
  if (ws) ws.close();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    } else if (m.method === 'Page.javascriptDialogOpening') {
      cdpSend('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    } else if (m.method === 'Runtime.consoleAPICalled') {
      const args = (m.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
      if (/SAIC|LinkedIn/i.test(args)) { diag.consoleLines.push(args); console.log('    [page]', String(args).slice(0, 160)); }
    }
  };
  await cdpSend('Runtime.enable');
  await cdpSend('Page.enable');
  return page;
}

async function shot(name) {
  try {
    const s = await cdpSend('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, 'live-li-' + name + '.png'), Buffer.from(s.data, 'base64'));
  } catch (e) { /* non-fatal */ }
}

// Read the extension's saved settings through its service worker (the page's
// main world has no chrome.* access). SW may be asleep → caller handles null.
async function readMentionPageFromSW() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const sw = targets.find(t => t.type === 'service_worker' && /^chrome-extension:\/\//.test(t.url));
  if (!sw) return null;
  const swWs = new WebSocket(sw.webSocketDebuggerUrl);
  try {
    await new Promise((res, rej) => { swWs.onopen = res; swWs.onerror = rej; });
    const r = await new Promise((resolve, reject) => {
      const id = 1;
      const onMsg = ev => {
        const m = JSON.parse(ev.data);
        if (m.id === id) { swWs.onmessage = null; m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
      };
      swWs.onmessage = onMsg;
      swWs.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: `(async () => { const r = await new Promise(res => chrome.storage.local.get('socialAiCopilot_settings', res)); const s = r.socialAiCopilot_settings || {}; const li = (s.platformSettings && s.platformSettings.linkedin) || {}; return (li.mentionPages || [])[0] || ''; })()`, awaitPromise: true, returnByValue: true } }));
      setTimeout(() => reject(new Error('SW eval timeout')), 10000);
    });
    return (r.result && r.result.value) || null;
  } catch (e) { return null; } finally { try { swWs.close(); } catch (e) {} }
}

async function main() {
  console.log('== LIVE LinkedIn diagnostics (Phase A) ==');
  await attach('linkedin');
  let url = await evalInPage('location.href');
  if (!/linkedin\.com/.test(url)) {
    await cdpSend('Page.navigate', { url: 'https://www.linkedin.com/feed/' });
    await sleep(8000);
    await attach('linkedin'); // re-attach: navigation may have swapped the target
    url = await evalInPage('location.href');
  }
  diag.url = url;
  const walled = await evalInPage(`/login/.test(location.href) || !!document.querySelector('input[type="password"]')`);
  if (walled) {
    console.log('\nLOGIN REQUIRED: the debug Chrome is on the LinkedIn login page.');
    console.log('Log in inside that window (profile persists), then re-run this script.');
    process.exit(3);
  }
  console.log('Logged in:', url.slice(0, 70));
  await cdpSend('Page.bringToFront').catch(() => {});
  await sleep(4000); // feed hydration

  // ── 1. Scroll-root probe ──────────────────────────────────────────────
  console.log('\n[1] scroll-root probe');
  diag.scroll = await evalInPage(`(async function () {
    function metrics(el) { return { tag: el.tagName, id: el.id || '', cls: (el.className + '').slice(0, 60), overflowY: getComputedStyle(el).overflowY, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop }; }
    var out = { window: null, candidates: [] };
    // window probe
    var y0 = window.scrollY;
    window.scrollTo(0, y0 + 800);
    await new Promise(r => setTimeout(r, 450));
    out.window = { before: y0, after: window.scrollY, moved: window.scrollY - y0 };
    window.scrollTo(0, y0);
    await new Promise(r => setTimeout(r, 250));
    // inner-container candidates: fixed hooks + scrollable ancestors of first post
    var seen = new Set(); var roots = [];
    ['#main', 'main', '[role="main"]', '[data-testid="mainFeed"]'].forEach(function (s) { try { var e = document.querySelector(s); if (e) roots.push(e); } catch (e2) {} });
    var firstPost = document.querySelector('[data-testid="mainFeed"] [role="listitem"]');
    var a = firstPost;
    while (a && a !== document.body) { roots.push(a); a = a.parentElement; }
    for (var i = 0; i < roots.length; i++) {
      var el = roots[i];
      if (!el || seen.has(el) || el === document.body || el === document.documentElement) continue;
      seen.add(el);
      var oy = getComputedStyle(el).overflowY;
      var scrollable = (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 8;
      if (!scrollable) continue;
      var st0 = el.scrollTop;
      el.scrollTop = st0 + 600;
      await new Promise(r => setTimeout(r, 450));
      out.candidates.push({ selector: (el.id ? '#' + el.id : el.tagName.toLowerCase()), m: metrics(el), moved: el.scrollTop - st0 });
      el.scrollTop = st0;
      await new Promise(r => setTimeout(r, 200));
    }
    window.scrollTo(0, y0);
    return out;
  })()`, true);
  console.log('  window moved:', diag.scroll.window.moved + 'px');
  diag.scroll.candidates.forEach(c => console.log('  inner:', c.selector, 'moved', c.moved + 'px', '(sh ' + c.m.scrollHeight + '/ch ' + c.m.clientHeight + ')'));
  await shot('scroll');

  // ── 2. Feed census ────────────────────────────────────────────────────
  console.log('\n[2] feed census (real posts vs modules)');
  diag.census = await evalInPage(`(function () {
    var items = document.querySelectorAll('[data-testid="mainFeed"] [role="listitem"]');
    var CB = 'button[aria-label="Comment"], button[aria-label*="Comment"], button[aria-label*="comment"], button[data-control-name="comment.toggle"]';
    var rows = []; var firstReal = null; var nonPostSamples = [];
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      var cb = el.querySelector(CB);
      var ext = el.querySelector('[data-testid="expandable-text-box"]');
      var extText = ext ? (ext.textContent || '').trim() : '';
      var urn = el.getAttribute('data-urn') || (el.querySelector('[data-urn]') ? el.querySelector('[data-urn]').getAttribute('data-urn') : '');
      var author = el.querySelector('a[href*="/in/"], a[href*="/company/"]');
      var textLen = (el.innerText || '').trim().length;
      var real = !!(cb || (extText.length > 40) || urn);
      rows.push({ i: i, real: real, cb: !!cb, extTextLen: extText.length, urn: !!urn, author: !!author, textLen: textLen,
        nestedInListitem: !!(el.parentElement && el.parentElement.closest('[role="listitem"]')) });
      if (real && !firstReal) firstReal = el;
      if (!real && nonPostSamples.length < 2) nonPostSamples.push(el.outerHTML.slice(0, 400));
    }
    var btns = [];
    if (firstReal) {
      var allB = firstReal.querySelectorAll('button');
      for (var b = 0; b < allB.length; b++) btns.push({ aria: (allB[b].getAttribute('aria-label') || '').slice(0, 80), text: (allB[b].textContent || '').trim().slice(0, 30), disabled: allB[b].disabled });
    }
    return { total: items.length, real: rows.filter(function (r) { return r.real; }).length, rows: rows.slice(0, 20),
      firstPostButtons: btns.slice(0, 25), nonPostSamples: nonPostSamples,
      firstPostHtml: firstReal ? firstReal.outerHTML.slice(0, 2500) : '' };
  })()`);
  console.log('  listitems:', diag.census.total, '· real posts:', diag.census.real);
  diag.census.firstPostButtons.slice(0, 12).forEach(b => console.log('   btn aria="' + b.aria + '" text="' + b.text + '"' + (b.disabled ? ' [disabled]' : '')));
  if (diag.census.nonPostSamples.length) console.log('  non-post modules captured:', diag.census.nonPostSamples.length);

  // ── 3. Composer probe ─────────────────────────────────────────────────
  console.log('\n[3] composer probe (click comment button)');
  diag.composer = await evalInPage(`(async function () {
    var CB = 'button[aria-label="Comment"], button[aria-label*="Comment"], button[aria-label*="comment"], button[data-control-name="comment.toggle"]';
    var items = document.querySelectorAll('[data-testid="mainFeed"] [role="listitem"]');
    var post = null, btn = null;
    for (var i = 0; i < items.length; i++) { btn = items[i].querySelector(CB); if (btn) { post = items[i]; break; } }
    if (!post) return { ok: false, why: 'no comment button found on any listitem' };
    btn.scrollIntoView({ block: 'center' });
    await new Promise(r => setTimeout(r, 500));
    var postWas = post; // reference identity for comparison after re-render
    btn.click();
    for (var t = 0; t < 15; t++) {
      await new Promise(r => setTimeout(r, 300));
      var ed = document.querySelector('.tiptap.ProseMirror[contenteditable="true"], .ql-editor[contenteditable="true"]');
      if (ed && ed.getBoundingClientRect().height > 10) {
        var li = ed.closest('[role="listitem"]');
        var scope = li || document;
        var btns = [];
        var allB = scope.querySelectorAll('button');
        for (var b = 0; b < allB.length; b++) {
          btns.push({ aria: (allB[b].getAttribute('aria-label') || '').slice(0, 80), text: (allB[b].textContent || '').trim().slice(0, 30),
            disabled: allB[b].disabled, type: allB[b].getAttribute('type') || '', testid: allB[b].getAttribute('data-testid') || '' });
        }
        return { ok: true, editorCls: ed.className, editorHtml: ed.outerHTML.slice(0, 600),
          inSameListitemAsPost: li === postWas, listitemFound: !!li,
          composerButtons: btns.slice(0, 30) };
      }
    }
    return { ok: false, why: 'no visible .tiptap/.ql-editor 4.5s after click' };
  })()`, true);
  if (diag.composer.ok) {
    console.log('  composer opened:', diag.composer.editorCls.slice(0, 60));
    console.log('  in same listitem as post:', diag.composer.inSameListitemAsPost);
    diag.composer.composerButtons.forEach(b => console.log('   btn aria="' + b.aria + '" text="' + b.text + '" type="' + b.type + '" testid="' + b.testid + '"' + (b.disabled ? ' [disabled]' : '')));
  } else {
    console.log('  FAILED:', diag.composer.why);
  }
  await shot('composer');

  // ── 4. Mention dropdown probe ─────────────────────────────────────────
  console.log('\n[4] mention dropdown probe');
  const pageName = (await readMentionPageFromSW()) || 'a';
  console.log('  page name from settings:', pageName === 'a' ? '(none configured — probing with "a")' : pageName);
  diag.mention = await evalInPage(`(async function () {
    var pageName = ${JSON.stringify(pageName)};
    var ed = document.querySelector('.tiptap.ProseMirror[contenteditable="true"], .ql-editor[contenteditable="true"]');
    if (!ed) return { ok: false, why: 'no editor open (composer probe failed)' };
    var before = Array.prototype.slice.call(document.body.children);
    ed.focus();
    ed.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: '@' }));
    document.execCommand('insertText', false, '@');
    for (var c = 0; c < pageName.length; c++) {
      await new Promise(r => setTimeout(r, 70));
      document.execCommand('insertText', false, pageName[c]);
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await new Promise(r => setTimeout(r, 2500));
    var newNodes = [];
    for (var i = 0; i < document.body.children.length; i++) {
      var n = document.body.children[i];
      if (before.indexOf(n) === -1) {
        var rect = n.getBoundingClientRect();
        newNodes.push({ cls: (n.className + '').slice(0, 80), role: n.getAttribute('role') || '',
          rect: { w: Math.round(rect.width), h: Math.round(rect.height), top: Math.round(rect.top) },
          text: (n.textContent || '').trim().slice(0, 200), html: n.outerHTML.slice(0, 700) });
      }
    }
    var announcers = [];
    document.querySelectorAll('[role="status"]').forEach(function (s) {
      var l = s.getAttribute('aria-label') || '';
      if (/suggest/i.test(l)) announcers.push(l.slice(0, 120));
    });
    var listboxes = [];
    document.querySelectorAll('[role="listbox"]').forEach(function (lb) {
      var opts = [];
      lb.querySelectorAll('[role="option"]').forEach(function (o) { if (opts.length < 5) opts.push((o.textContent || '').trim().slice(0, 60)); });
      listboxes.push({ cls: (lb.className + '').slice(0, 60), options: opts });
    });
    var editorText = (ed.textContent || '');
    var chips = ed.querySelectorAll('a[href], [data-mention], [data-id^="urn:li:"], [data-entity-type]').length;
    // cleanup: dismiss dropdown, clear text
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', keyCode: 27 }));
    ed.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    return { ok: true, typed: '@' + pageName, newBodyNodes: newNodes, announcers: announcers, listboxes: listboxes,
      editorTextAfter: editorText.slice(0, 120), editorChipCount: chips };
  })()`, true);
  if (diag.mention.ok) {
    console.log('  new body nodes after @:', diag.mention.newBodyNodes.length);
    diag.mention.newBodyNodes.slice(0, 3).forEach(n => console.log('   node cls="' + n.cls + '" role="' + n.role + '" ' + n.rect.w + 'x' + n.rect.h + ' text="' + n.text.slice(0, 60) + '"'));
    console.log('  announcers:', JSON.stringify(diag.mention.announcers));
    console.log('  listboxes:', diag.mention.listboxes.length, '· editor text:', JSON.stringify(diag.mention.editorTextAfter));
  } else {
    console.log('  SKIPPED:', diag.mention.why);
  }
  await shot('mention');

  fs.writeFileSync(path.join(__dirname, 'live-linkedin-diag.json'), JSON.stringify(diag, null, 2));
  console.log('\nWrote test/live-linkedin-diag.json · screenshots: live-li-*.png');
}

main().catch(e => { console.error('LIVE ERROR:', e.message); process.exit(2); });
