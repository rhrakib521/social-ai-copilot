// Probe 3: ancestor chains of real post-text spans + comment-box hunt on live LinkedIn.
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

  const out = await evalp(`(() => {
    function chain(el) {
      const lines = [];
      let cur = el, depth = 0;
      while (cur && depth < 22 && cur !== document.body) {
        const attrs = [];
        if (cur.attributes) for (const a of cur.attributes) {
          if (/^(data-|aria-|role$|dir$|tabindex$)/.test(a.name) || a.name === 'id') attrs.push(a.name + '=' + a.value.slice(0, 40));
        }
        lines.push('  '.repeat(depth) + cur.tagName.toLowerCase() + (cur.className ? '.' + String(cur.className).split(' ').slice(0, 2).join('.') : '') + (attrs.length ? ' [' + attrs.join(' ') + ']' : ''));
        cur = cur.parentElement; depth++;
      }
      return lines.join('\\n');
    }
    // 1. ancestor chain of the longest content span (skip style/script)
    const spans = Array.from(document.querySelectorAll('span, p, div')).filter(e => {
      if (!e.textContent || e.textContent.length < 200) return false;
      const t = e.tagName.toLowerCase();
      if (t === 'style' || t === 'script') return false;
      // direct-text-ish: no long-text children of its own beyond itself
      return true;
    }).sort((a, b) => a.textContent.length - b.textContent.length);
    const contentEl = spans[0];
    const chain1 = contentEl ? chain(contentEl) : '(none)';
    // 2. comment affordances
    const editables = Array.from(document.querySelectorAll('[contenteditable="true"], [role="textbox"]')).slice(0, 6)
      .map(e => ({ tag: e.tagName.toLowerCase(), cls: String(e.className).slice(0, 50), aria: (e.getAttribute('aria-label') || '').slice(0, 60), chain: chain(e).split('\\n').slice(0, 6).join('\\n') }));
    const commentBtns = Array.from(document.querySelectorAll('[aria-label*="omment" i], button')).filter(e => /comment/i.test(e.getAttribute('aria-label') || '') || /comment/i.test(e.textContent || '')).slice(0, 5)
      .map(e => ({ tag: e.tagName.toLowerCase(), aria: (e.getAttribute('aria-label') || '').slice(0, 70), text: (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40), chain: chain(e).split('\\n').slice(0, 4).join('\\n') }));
    // 3. any data-* attributes in the whole page (name census)
    const dataAttrs = {};
    document.querySelectorAll('*').forEach(el => {
      for (const a of el.attributes) {
        if (a.name.startsWith('data-')) dataAttrs[a.name] = (dataAttrs[a.name] || 0) + 1;
      }
    });
    // 4. how many posts-ish items? count elements whose text is 200+ chars AND are top-most such (post containers)
    const postish = [];
    document.querySelectorAll('div, section').forEach(el => {
      const ownText = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('');
      if (ownText.replace(/\\s+/g, ' ').trim().length > 150) postish.push(el);
    });
    return JSON.stringify({
      longestContentEl: { tag: contentEl && contentEl.tagName.toLowerCase(), text: contentEl && contentEl.textContent.replace(/\\s+/g, ' ').slice(0, 90) },
      chain_longestContent: chain1,
      editables, commentBtns,
      dataAttrCensus: Object.entries(dataAttrs).sort((a, b) => b[1] - a[1]).slice(0, 25),
      directTextDivCount: postish.length,
      postishSample: postish.slice(0, 3).map(e => chain(e).split('\\n').slice(0, 5).join('\\n'))
    }, null, 1);
  })()`);
  console.log(out);
  process.exit(0);
}
main().catch(e => { console.error('PROBE ERROR:', e.message); process.exit(1); });
