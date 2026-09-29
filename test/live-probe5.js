// Probe 5: real post container = ancestor of button[aria-label="Comment"];
// inspect interop-shadowdom / interop-iframe (editor may live there); re-click
// Comment and diff the DOM.
const DEBUG_PORT = process.env.SAIC_DEBUG_PORT || 9223;

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  const page = targets.find(t => t.type === 'page' && /linkedin\.com\/feed/.test(t.url));
  if (!page) throw new Error('no feed tab');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 25000);
  });
  const evalp = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  };

  // A. the post container around the first real Comment button
  const post = await evalp(`(() => {
    const btns = Array.from(document.querySelectorAll('button[aria-label="Comment"]'));
    const btn = btns.find(b => /\\d/.test(b.textContent || '')) || btns[0];
    if (!btn) return 'NO COMMENT BUTTONS';
    // climb to the listitem
    let li = btn.closest('[role="listitem"]') || btn.parentElement;
    const spans = Array.from(li.querySelectorAll('span')).map(s => (s.textContent || '').replace(/\\s+/g, ' ').trim()).filter(t => t.length >= 50);
    const expandable = li.querySelectorAll('[data-testid="expandable-text-box"]').length;
    const anchors = Array.from(li.querySelectorAll('a span')).map(s => (s.textContent || '').trim()).filter(t => t.length > 2 && t.length < 60).slice(0, 6);
    const btns2 = Array.from(li.querySelectorAll('button[aria-label]')).map(b => b.getAttribute('aria-label').slice(0, 45)).slice(0, 10);
    // describe expandable-text-box first child structure
    const etb = li.querySelector('[data-testid="expandable-text-box"]');
    let etbInfo = null;
    if (etb) {
      const ch = Array.from(etb.children).map(c => c.tagName.toLowerCase() + (String(c.className) ? '.' + String(c.className).split(' ')[0] : ''));
      etbInfo = { children: ch, textSample: (etb.textContent || '').replace(/\\s+/g, ' ').slice(0, 130) };
    }
    return JSON.stringify({ liClass: String(li.className).slice(0, 60), liRole: li.getAttribute('role'),
      longSpans: spans.slice(0, 3), expandableCount: expandable, etbInfo, authorCandidates: anchors, buttons: btns2 }, null, 1);
  })()`);
  console.log('[A] post container around Comment button:\n' + post);

  // B. interop shadowdom + iframes
  const interop = await evalp(`(() => {
    const hosts = Array.from(document.querySelectorAll('[data-testid="interop-shadowdom"], [data-testid="interop-iframe"]'));
    const out = hosts.map(h => {
      const sr = h.shadowRoot;
      let inner = null;
      if (sr) {
        const eds = sr.querySelectorAll('[contenteditable="true"], [role="textbox"]');
        inner = { shadowChildren: Array.from(sr.children).map(c => c.tagName.toLowerCase()).slice(0, 6), editors: eds.length,
          textSample: (sr.textContent || '').replace(/\\s+/g, ' ').slice(0, 100) };
      }
      return { testid: h.getAttribute('data-testid'), hasShadow: !!sr, aria: (h.getAttribute('aria-label') || '').slice(0, 40), inner };
    });
    const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({ src: (f.src || '').slice(0, 90), aria: (f.getAttribute('aria-label') || f.title || '').slice(0, 40) }));
    return JSON.stringify({ interop: out, iframes }, null, 1);
  })()`);
  console.log('[B] interop + iframes:\n' + interop);

  // C. click Comment again and diff: dialogs, shadow editors, anywhere-editors
  const after = await evalp(`(async () => {
    const btns = Array.from(document.querySelectorAll('button[aria-label="Comment"]'));
    const btn = btns.find(b => /\\d/.test(b.textContent || '')) || btns[0];
    btn.click();
    await new Promise(r => setTimeout(r, 3000));
    // search EVERYWHERE including shadow roots (1 level deep)
    function findAllIn(root, sel, acc) {
      acc.push(...root.querySelectorAll(sel));
      root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) findAllIn(el.shadowRoot, sel, acc); });
      return acc;
    }
    const eds = findAllIn(document, '[contenteditable="true"], [role="textbox"]', []);
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).map(d => (d.getAttribute('aria-label') || '').slice(0, 50));
    const desc = eds.slice(0, 3).map(e => {
      const ch = []; let c = e, d = 0;
      while (c && d < 8) { ch.push(c.tagName.toLowerCase() + (String(c.className) ? '.' + String(c.className).split(' ')[0] : '') + (c.getAttribute && c.getAttribute('aria-label') ? '[aria=' + c.getAttribute('aria-label').slice(0, 35) + ']' : '') + (c.host ? '(shadow-host)' : '')); c = c.parentElement || (c.getRootNode && c.getRootNode().host); d++; }
      return ch.join(' < ');
    });
    return JSON.stringify({ editorCount: eds.length, editorChains: desc, dialogs, activeEl: document.activeElement && document.activeElement.tagName + '.' + String(document.activeElement.className).slice(0, 30) }, null, 1);
  })()`, true);
  console.log('[C] after second Comment click:\n' + after);
  process.exit(0);
}
main().catch(e => { console.error('PROBE ERROR:', e.message); process.exit(1); });
