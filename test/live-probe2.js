// Deep probe: find where post content actually lives on live LinkedIn —
// walks into shadow roots, maps custom elements + text-heavy regions.
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

  const out = await evalp(`(async () => {
    // 1. custom elements present?
    const all = document.querySelectorAll('*');
    const tags = {};
    let shadowHosts = [];
    for (const el of all) {
      const t = el.tagName.toLowerCase();
      if (t.includes('-')) tags[t] = (tags[t] || 0) + 1;
      if (el.shadowRoot) shadowHosts.push(t + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
      if (shadowHosts.length > 40) break;
    }
    // 2. recursive walk incl. shadow roots: find the LONGEST visible text nodes
    const found = [];
    const seenRoots = new Set();
    function walkRoot(root, depth) {
      if (!root || seenRoots.has(root) || found.length > 60) return;
      seenRoots.add(root);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const t = (n.textContent || '').replace(/\\s+/g, ' ').trim();
        if (t.length > 120) {
          const p = n.parentElement;
          found.push({ len: t.length, text: t.slice(0, 110),
            tag: p ? p.tagName.toLowerCase() : '?', cls: p ? String(p.className).slice(0, 60) : '',
            inShadow: p ? (p.getRootNode() !== document) : false });
        }
        if (found.length > 60) break;
      }
      // descend into shadow roots under this root
      root.querySelectorAll && root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) walkRoot(el.shadowRoot, depth + 1); });
    }
    walkRoot(document, 0);
    found.sort((a, b) => b.len - a.len);
    // 3. does main's kid have shadow roots?
    const mainKid = document.querySelector('main') && document.querySelector('main').querySelector('div');
    const kidShadow = mainKid ? !!mainKid.shadowRoot : null;
    return JSON.stringify({ customTags: tags, shadowHostSample: shadowHosts.slice(0, 25), shadowHostCount: shadowHosts.length,
      longestTexts: found.slice(0, 8), mainKidHasShadow: kidShadow }, null, 1);
  })()`);
  console.log(out);
  process.exit(0);
}
main().catch(e => { console.error('PROBE ERROR:', e.message); process.exit(1); });
