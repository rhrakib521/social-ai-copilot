// Focused follow-up probe for the live LinkedIn composer: what does the
// submit button look like ONCE TEXT EXISTS (aria-label, disabled lifecycle),
// and what does a real mention chip look like after selecting a dropdown
// option. Informs findAndClickSubmit + verifyMentionInserted.
// Run: node test/live-li-submit-probe.js   (debug Chrome on :9223, logged in)

const PORT = process.env.SAIC_DEBUG_PORT || 9223;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws = null, msgId = 0;
const pending = new Map();

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

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find(t => t.type === 'page' && /linkedin\.com\/feed/.test(t.url));
  if (!page) throw new Error('No LinkedIn feed tab — run live-linkedin-engine.js first');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    } else if (m.method === 'Page.javascriptDialogOpening') {
      cdpSend('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    }
  };
  await cdpSend('Runtime.enable');
  await cdpSend('Page.enable');
  await cdpSend('Page.bringToFront').catch(() => {});

  const out = await evalInPage(`(async function () {
    var res = { steps: [] };
    function composerArea(ed) {
      // the editor's enclosing block that holds its toolbar buttons
      return ed.closest('[role="listitem"]') || ed.parentElement;
    }
    function snapButtons(ed) {
      var area = composerArea(ed);
      var btns = [];
      area.querySelectorAll('button').forEach(function (b) {
        var aria = (b.getAttribute('aria-label') || '');
        if (!aria && !(b.textContent || '').trim()) return; // skip icon-only no-name
        btns.push({ aria: aria.slice(0, 100), text: (b.textContent || '').trim().slice(0, 40), disabled: b.disabled,
          ariaDisabled: b.getAttribute('aria-disabled'), testid: b.getAttribute('data-testid') || '' });
      });
      return btns;
    }
    // Open a composer on a real post
    var CB = 'button[aria-label="Comment"], button[aria-label*="Comment"], button[aria-label*="comment"]';
    var items = document.querySelectorAll('[data-testid="mainFeed"] [role="listitem"]');
    var post = null, btn = null;
    for (var i = 0; i < items.length; i++) { btn = items[i].querySelector(CB); if (btn) { post = items[i]; break; } }
    if (!post) return { error: 'no comment button' };
    btn.scrollIntoView({ block: 'center' });
    await new Promise(r => setTimeout(r, 400));
    btn.click();
    var ed = null;
    for (var t = 0; t < 15; t++) {
      await new Promise(r => setTimeout(r, 300));
      ed = post.querySelector('.tiptap.ProseMirror[contenteditable="true"]');
      if (ed && ed.getBoundingClientRect().height > 10) break;
      ed = null;
    }
    if (!ed) return { error: 'composer did not open' };
    res.editorCls = ed.className;

    // A. buttons while EMPTY
    res.emptyButtons = snapButtons(ed).filter(function (b) { return /comment|post|reply|submit|send/i.test(b.aria + ' ' + b.text); });

    // B. type plain text → capture submit appearance + disabled lifecycle
    ed.focus();
    document.execCommand('insertText', false, 'Solid build');
    await new Promise(r => setTimeout(r, 900));
    res.afterTextButtons = snapButtons(ed).filter(function (b) { return /comment|post|reply|submit|send/i.test(b.aria + ' ' + b.text); });
    res.editorTextAfterType = (ed.textContent || '').slice(0, 60);

    // C. clear, then mention: type @, first name of a suggested option
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    await new Promise(r => setTimeout(r, 300));
    ed.focus();
    document.execCommand('insertText', false, '@');
    var lb = null;
    for (var t2 = 0; t2 < 12; t2++) {
      await new Promise(r => setTimeout(r, 250));
      lb = document.querySelector('[role="listbox"]');
      if (lb && lb.querySelectorAll('[role="option"]').length) break;
      lb = null;
    }
    res.listboxAppeared = !!lb;
    if (lb) {
      var opts = lb.querySelectorAll('[role="option"]');
      res.optionCount = opts.length;
      res.firstOptionText = (opts[0].textContent || '').trim().slice(0, 100);
      res.listboxHtml = lb.outerHTML.slice(0, 900);
      // Click the FIRST option (real person suggestion; probe only — will clear)
      opts[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse' }));
      opts[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      opts[0].dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse' }));
      opts[0].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
      opts[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
      await new Promise(r => setTimeout(r, 1200));
      res.editorHtmlAfterSelect = ed.outerHTML.slice(0, 1200);
      res.editorTextAfterSelect = (ed.textContent || '').slice(0, 120);
      res.chipSelectorHit = {
        anchorHref: Array.prototype.map.call(ed.querySelectorAll('a[href]'), function (a) { return a.getAttribute('href'); }).slice(0, 3),
        dataMention: ed.querySelectorAll('[data-mention]').length,
        dataIdUrn: ed.querySelectorAll('[data-id^="urn:li:"]').length,
        dataEntity: ed.querySelectorAll('[data-entity-type]').length,
        spansWithClass: Array.prototype.map.call(ed.querySelectorAll('span[class]'), function (s) { return s.className.slice(0, 50); }).slice(0, 5)
      };
      res.listboxGoneAfterSelect = !document.querySelector('[role="listbox"]');
    }

    // D. cleanup — clear composer text and dismiss
    ed.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', keyCode: 27 }));
    document.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Escape', keyCode: 27 }));
    await new Promise(r => setTimeout(r, 400));
    res.cleanedText = (ed.textContent || '').trim();
    return res;
  })()`, true);
  console.log(JSON.stringify(out, null, 2));
}

main().catch(e => { console.error('PROBE ERROR:', e.message); process.exit(2); });
