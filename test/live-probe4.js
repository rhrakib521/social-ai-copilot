// Probe 4: data-testid census, per-listitem text structure, and what a real
// Comment-button click opens (editor markup) on live LinkedIn SDUI feed.
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 20000);
  });
  const evalp = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // A. data-testid census
  const census = await evalp(`(() => {
    const v = {};
    document.querySelectorAll('[data-testid]').forEach(e => { const t = e.getAttribute('data-testid'); v[t] = (v[t] || 0) + 1; });
    return JSON.stringify(v);
  })()`);
  console.log('[A] data-testid census:', census);

  // B. first 3 feed listitems: long-text spans, anchors, reaction/comment buttons
  const items = await evalp(`(() => {
    const list = document.querySelector('[data-testid="mainFeed"][role="list"]') || document.querySelector('[role="list"][data-component-type="LazyColumn"]');
    if (!list) return 'NO FEED LIST';
    const items = Array.from(list.querySelectorAll(':scope > [role="listitem"], [role="listitem"]')).slice(0, 3);
    return JSON.stringify(items.map(li => {
      const spans = Array.from(li.querySelectorAll('span')).map(s => (s.textContent || '').replace(/\\s+/g, ' ').trim())
        .filter(t => t.length >= 60).slice(0, 2);
      const anchors = Array.from(li.querySelectorAll('a')).slice(0, 4).map(a => (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40)).filter(Boolean);
      const btns = Array.from(li.querySelectorAll('button[aria-label]')).slice(0, 8)
        .map(b => b.getAttribute('aria-label').slice(0, 50) + ' [' + (b.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 8) + ']');
      return { spans, anchors, btns };
    }), null, 1);
  })()`);
  console.log('[B] first 3 listitems:\n' + items);

  // C. click the FIRST Comment button and inspect the editor that appears
  const clicked = await evalp(`(async () => {
    const btn = document.querySelector('button[aria-label="Comment"]');
    if (!btn) return 'NO COMMENT BUTTON';
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    await new Promise(r => setTimeout(r, 2500));
    const eds = Array.from(document.querySelectorAll('[contenteditable="true"], [role="textbox"]'));
    const describe = (e) => {
      const attrs = [];
      for (const a of e.attributes) attrs.push(a.name + '=' + a.value.slice(0, 30));
      // chain up 6
      const ch = []; let c = e, d = 0;
      while (c && d < 6) { ch.push(c.tagName.toLowerCase() + (String(c.className) ? '.' + String(c.className).split(' ')[0] : '') + (c.getAttribute && c.getAttribute('aria-label') ? ' [aria=' + c.getAttribute('aria-label').slice(0, 30) + ']' : '')); c = c.parentElement; d++; }
      return { attrs: attrs.join(' '), chain: ch.join(' > ') };
    };
    return JSON.stringify({ count: eds.length, editors: eds.slice(0, 3).map(describe) }, null, 1);
  })()`, true);
  console.log('[C] after clicking Comment:\n' + clicked);
  process.exit(0);
}
main().catch(e => { console.error('PROBE ERROR:', e.message); process.exit(1); });
