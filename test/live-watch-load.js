// Polls chrome://extensions until the unpacked extension appears (user picks
// the folder), then reports its id. Exits 0 when found.
const DEBUG_PORT = process.env.SAIC_DEBUG_PORT || 9223;

async function main() {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const ext = targets.find(t => t.type === 'page' && /chrome:\/\/extensions/.test(t.url));
      if (ext) {
        const ws = new WebSocket(ext.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        let id = 0; const pending = new Map();
        ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
        const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
        const r = await send('Runtime.evaluate', { expression: `(function () {
          try {
            const items = document.querySelector('extensions-manager').shadowRoot
              .querySelector('extensions-item-list').shadowRoot.querySelectorAll('extensions-item');
            const list = Array.from(items).map(i => ({ id: i.id, name: (i.shadowRoot.querySelector('#name')||{textContent:'?'}).textContent.trim() }));
            return JSON.stringify(list);
          } catch (e) { return '[]'; }
        })()`, returnByValue: true });
        ws.close();
        const list = JSON.parse(r.result.value || '[]');
        const ours = list.find(x => !/Google/i.test(x.name));
        if (ours) { console.log('[watch] EXTENSION LOADED:', JSON.stringify(ours)); process.exit(0); }
      }
    } catch (e) { /* browser restarting or tab closed */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.error('[watch] timeout — extension never appeared');
  process.exit(1);
}
main().catch(e => { console.error('[watch] ERROR:', e.message); process.exit(1); });
