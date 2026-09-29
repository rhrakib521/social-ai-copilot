// LIVE probe: why did the engine's scroll nudge fail on a scrollable
// #workspace? Tests scroll-behavior, immediate scrollTop writes, delayed
// reads, and which elements the resolver would pick. Main-world only.
// Run: node test/live-scroll-probe.js   (debug Chrome up, feed tab open)

const PORT = process.env.SAIC_DEBUG_PORT || 9223;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let ws = null, msgId = 0;
const pending = new Map();
function cdpSend(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 20000);
  });
}
async function ev(expression, awaitPromise = false) {
  const r = await cdpSend('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200));
  return r.result && r.result.value;
}

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find(t => t.type === 'page' && /linkedin\.com\/feed/.test(t.url));
  if (!page) { console.log('no feed tab'); process.exit(2); }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  };
  await cdpSend('Runtime.enable');
  await cdpSend('Page.enable');
  await cdpSend('Page.bringToFront').catch(() => {});
  await sleep(1500);

  const hidden = await ev('document.hidden');
  console.log('document.hidden =', hidden);

  const info = await ev(`(function () {
    var w = document.querySelector('#workspace, main');
    if (!w) return { err: 'no workspace' };
    var cs = getComputedStyle(w);
    return {
      tag: w.tagName, id: w.id,
      overflowY: cs.overflowY,
      scrollBehavior: cs.scrollBehavior,
      scrollHeight: w.scrollHeight,
      clientHeight: w.clientHeight,
      scrollTop: w.scrollTop,
      maxScroll: w.scrollHeight - w.clientHeight,
      // engine resolver criteria check on all ancestors of the first listitem
      chain: (function () {
        var out = [];
        var a = document.querySelector('[data-testid="mainFeed"] [role="listitem"]') || document.querySelector('[data-testid="mainFeed"]');
        for (var el = a; el && el !== document.documentElement; el = el.parentElement) {
          var s = getComputedStyle(el);
          out.push({ tag: el.tagName, id: el.id || '', cls: (el.className + '').slice(0, 40), oy: s.overflowY, sh: el.scrollHeight, ch: el.clientHeight, qualifies: (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 8 });
        }
        return out;
      })()
    };
  })()`);
  console.log(JSON.stringify(info, null, 1));

  // Direct write test: immediate + delayed read
  const t1 = await ev(`(function () {
    var w = document.querySelector('#workspace, main');
    var before = w.scrollTop;
    w.scrollTop = before + 120;
    var immediate = w.scrollTop;
    return { before: before, wrote: before + 120, immediate: immediate };
  })()`);
  console.log('write test:', JSON.stringify(t1));
  await sleep(300);
  const t2 = await ev(`(function () { var w = document.querySelector('#workspace, main'); return { scrollTop: w.scrollTop, windowY: window.scrollY }; })()`);
  console.log('after 300ms:', JSON.stringify(t2));

  // scrollIntoView test
  await ev(`(function () { var posts = document.querySelectorAll('[data-testid="mainFeed"] [role="listitem"]'); if (posts.length > 2) posts[2].scrollIntoView({ block: 'start' }); return true; })()`);
  await sleep(400);
  const t3 = await ev(`(function () { var w = document.querySelector('#workspace, main'); return { scrollTop: w.scrollTop, windowY: window.scrollY }; })()`);
  console.log('after scrollIntoView:', JSON.stringify(t3));

  // restore top
  await ev(`(function () { var w = document.querySelector('#workspace, main'); w.scrollTop = 0; return true; })()`).catch(() => {});
  process.exit(0);
}
main().catch(e => { console.error('PROBE ERROR:', e.message); process.exit(2); });
