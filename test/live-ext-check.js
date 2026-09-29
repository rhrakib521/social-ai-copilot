// Check chrome://extensions in the live test browser: is our extension loaded?
// Reloads it if present. Dumps name/enabled/errors per item.
const DEBUG_PORT = process.env.SAIC_DEBUG_PORT || 9223;

async function main() {
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?chrome://extensions`, { method: 'PUT' });
  await new Promise(r => setTimeout(r, 2500));
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  const ext = targets.find(t => t.type === 'page' && /extensions/.test(t.url));
  if (!ext) throw new Error('could not open chrome://extensions');
  const ws = new WebSocket(ext.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) return 'EVAL-FAIL: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 200);
    return r.result && r.result.value;
  };

  const info = await ev(`(function () {
    const mgr = document.querySelector('extensions-manager');
    if (!mgr || !mgr.shadowRoot) return 'no manager';
    const list = mgr.shadowRoot.querySelector('extensions-item-list');
    if (!list || !list.shadowRoot) return 'no item list';
    const items = list.shadowRoot.querySelectorAll('extensions-item');
    return JSON.stringify(Array.from(items).map(i => {
      const sr = i.shadowRoot;
      const nameEl = sr.querySelector('#name');
      const enableToggle = sr.querySelector('#enableToggle');
      const errBtn = sr.querySelector('#errors-button');
      return {
        id: i.id,
        name: nameEl ? nameEl.textContent.trim() : '?',
        enabled: enableToggle ? enableToggle.checked : '?',
        hasError: !!errBtn,
        errText: errBtn ? errBtn.textContent.trim() : ''
      };
    }));
  })()`);
  console.log('[ext-check] installed items:', info);

  // Reload every item that has a reload button (our dev-mode unpacked one)
  const reloaded = await ev(`(function () {
    const items = document.querySelector('extensions-manager').shadowRoot
      .querySelector('extensions-item-list').shadowRoot.querySelectorAll('extensions-item');
    let n = 0;
    items.forEach(i => { const b = i.shadowRoot.querySelector('#dev-reload-button'); if (b) { b.click(); n++; } });
    return 'reloaded ' + n;
  })()`);
  console.log('[ext-check]', reloaded);

  // errors surface after a moment — dump the error list of any item with errors
  await new Promise(r => setTimeout(r, 1500));
  const errs = await ev(`(function () {
    const items = document.querySelector('extensions-manager').shadowRoot
      .querySelector('extensions-item-list').shadowRoot.querySelectorAll('extensions-item');
    const out = [];
    items.forEach(i => {
      const b = i.shadowRoot.querySelector('#errors-button');
      if (b) { b.click(); }
    });
    return 'clicked error buttons';
  })()`);
  console.log('[ext-check]', errs);
  await new Promise(r => setTimeout(r, 1200));
  const errDetail = await ev(`(function () {
    const dlg = document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-error-page, iron-overlay-backdrop');
    const page = document.querySelector('extensions-manager').shadowRoot;
    // error details dialog
    const detail = page.querySelector('#dialog');
    return (detail && detail.textContent || '').replace(/\\s+/g, ' ').slice(0, 600);
  })()`);
  console.log('[ext-check] error detail:', errDetail || '(none)');
  process.exit(0);
}
main().catch(e => { console.error('[ext-check] ERROR:', e.message); process.exit(1); });
