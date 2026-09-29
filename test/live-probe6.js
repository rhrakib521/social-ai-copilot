// Probe 6: TRUSTED click via CDP Input.dispatchMouseEvent on the Comment
// button (real browser events), then hunt the editor everywhere incl. shadow
// roots and the Modal Window dialogs.
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
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // what's inside the Modal Window dialogs right now?
  const modals = await evalp(`(() => {
    return JSON.stringify(Array.from(document.querySelectorAll('[role="dialog"]')).map(d => ({
      label: d.getAttribute('aria-label'), hidden: d.getAttribute('aria-hidden'),
      text: (d.textContent || '').replace(/\\s+/g, ' ').slice(0, 80),
      editors: d.querySelectorAll('[contenteditable="true"], [role="textbox"]').length
    })));
  })()`);
  console.log('[0] dialogs now:', modals);

  // locate Comment button with a count, scroll into view, get coords
  const coords = await evalp(`(() => {
    const btns = Array.from(document.querySelectorAll('button[aria-label="Comment"]'));
    const btn = btns.find(b => /\\d/.test(b.textContent || '')) || btns[0];
    if (!btn) return null;
    btn.scrollIntoView({ block: 'center' });
    const r = btn.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height });
  })()`);
  console.log('[1] Comment button coords:', coords);
  if (!coords) throw new Error('no comment button');
  const { x, y } = JSON.parse(coords);
  await sleep(700); // let scroll settle

  // TRUSTED click sequence
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(120);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  console.log('[2] trusted click dispatched at', x, y);
  await sleep(3500);

  // hunt editors EVERYWHERE (shadow roots incl.) + dialogs + URL
  const after = await evalp(`(() => {
    function findAllIn(root, sel, acc) {
      acc.push(...root.querySelectorAll(sel));
      root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) findAllIn(el.shadowRoot, sel, acc); });
      return acc;
    }
    const eds = findAllIn(document, '[contenteditable="true"], [role="textbox"]', []);
    const desc = eds.slice(0, 3).map(e => {
      const attrs = [];
      for (const a of e.attributes) attrs.push(a.name + '=' + a.value.slice(0, 25));
      const inShadow = e.getRootNode() !== document;
      return attrs.join(' ') + (inShadow ? ' [IN SHADOW]' : '');
    });
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).map(d => (d.getAttribute('aria-label') || '?') + (d.getAttribute('aria-hidden') === 'true' ? '(hidden)' : ''));
    return JSON.stringify({ url: location.href.slice(0, 70), editorCount: eds.length, editors: desc, dialogs, active: document.activeElement && document.activeElement.tagName + '.' + String(document.activeElement.className).slice(0, 40) }, null, 1);
  })()`);
  console.log('[3] after TRUSTED click:\n' + after);
  process.exit(0);
}
main().catch(e => { console.error('PROBE ERROR:', e.message); process.exit(1); });
