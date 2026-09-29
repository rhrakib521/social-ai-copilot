// One-time: enable Developer mode + click "Load unpacked" on chrome://extensions
// and copy the extension path to the user's clipboard. The user only picks the
// folder in the native dialog (paste + Enter).
const DEBUG_PORT = process.env.SAIC_DEBUG_PORT || 9223;

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  const ext = targets.find(t => t.type === 'page' && /chrome:\/\/extensions/.test(t.url));
  if (!ext) throw new Error('no chrome://extensions tab');
  const ws = new WebSocket(ext.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) return 'EVAL-FAIL: ' + JSON.stringify(r.exceptionDetails).slice(0, 200);
    return r.result && r.result.value;
  };

  // 1. Developer mode ON
  console.log('[unpack]', await ev(`(function () {
    const toolbar = document.querySelector('extensions-manager').shadowRoot
      .querySelector('extensions-toolbar');
    const toggle = toolbar.shadowRoot.querySelector('#devMode');
    if (!toggle) return 'no devMode toggle';
    if (!toggle.checked) { toggle.click(); }
    return 'dev mode: ' + (toggle.checked ? 'ON' : 'OFF');
  })()`));
  await new Promise(r => setTimeout(r, 800));

  // 2. count current items (for verification after user picks the folder)
  console.log('[unpack]', await ev(`(function () {
    const items = document.querySelector('extensions-manager').shadowRoot
      .querySelector('extensions-item-list').shadowRoot.querySelectorAll('extensions-item');
    return 'items now: ' + items.length;
  })()`));

  // 3. click "Load unpacked" — native folder dialog opens on the user's screen
  console.log('[unpack]', await ev(`(function () {
    const toolbar = document.querySelector('extensions-manager').shadowRoot
      .querySelector('extensions-toolbar');
    const btn = toolbar.shadowRoot.querySelector('#loadUnpacked');
    if (!btn) return 'no loadUnpacked button';
    btn.click();
    return 'Load unpacked CLICKED — folder dialog should be open';
  })()`));

  // 4. put the path in the clipboard (needs a non-restricted page — use the dialog
  //    opened from extensions page: clipboard API on chrome:// may be blocked, so
  //    fall back to a hidden textarea + execCommand)
  console.log('[unpack]', await ev(`(function () {
    const path = 'D:\\\\Coding\\\\Social Media Agent\\\\extension';
    try {
      const ta = document.createElement('textarea');
      ta.value = path;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, path.length);
      const ok = document.execCommand('copy');
      ta.remove();
      return 'clipboard: ' + (ok ? 'path copied' : 'execCommand failed');
    } catch (e) { return 'clipboard fail: ' + e.message; }
  })()`));
  process.exit(0);
}
main().catch(e => { console.error('[unpack] ERROR:', e.message); process.exit(1); });
