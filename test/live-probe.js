// One-off live DOM probe: what does the REAL LinkedIn feed markup look like?
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 15000);
  });
  const evalp = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };

  const probe = await evalp(`(() => {
    const sel = ['.feed-shared-update-v2', '[data-urn]', '[data-urn*="urn:li:activity"]', '.scaffold-finite-scroll__item',
      '.update-components-text', '.feed-shared-update-v2__commentary', '[role="article"]', '.comments-comment-box',
      'article', '[data-testid]', '.linkedin-activity', '.feed-shared-inline-show-more-text'];
    const counts = {};
    sel.forEach(s => { try { counts[s] = document.querySelectorAll(s).length; } catch (e) { counts[s] = 'INVALID'; } });
    const urns = Array.from(document.querySelectorAll('[data-urn]')).slice(0, 5).map(e => e.getAttribute('data-urn').slice(0, 60));
    // what does main contain?
    const main = document.querySelector('main') || document.body;
    const mainClasses = main.className.toString().slice(0, 100);
    // top-level children tag+class summary of main's scroll container
    const scroll = document.querySelector('.scaffold-finite-scroll, main div[class*="feed"], main');
    const kids = scroll ? Array.from(scroll.children).slice(0, 8).map(c => c.tagName + '.' + String(c.className).split(' ')[0]) : [];
    return JSON.stringify({ url: location.href, readyState: document.readyState, counts, urnSample: urns, mainClasses, scrollKids: kids,
      bodyLen: document.body.innerHTML.length }, null, 1);
  })()`);
  console.log(probe);

  // deepest text-ish container of the first article-ish thing
  const textSample = await evalp(`(() => {
    const cands = ['.feed-shared-update-v2 [dir="ltr"]', 'article [dir="ltr"]', '[data-urn] [dir="ltr"]', 'main [dir="ltr"]'];
    for (const s of cands) {
      const els = document.querySelectorAll(s);
      if (els.length) return s + ' → ' + els.length + ' matches; first text: ' + (els[0].textContent || '').replace(/\\s+/g, ' ').slice(0, 120);
    }
    return 'no [dir=ltr] anywhere: ' + document.querySelectorAll('[dir]').length + ' [dir] elems';
  })()`);
  console.log('\n[text probe]', textSample);
  process.exit(0);
}
main().catch(e => { console.error('PROBE ERROR:', e.message); process.exit(1); });
