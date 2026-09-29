// Focused test: the scroll-root resolver picks the element that actually
// scrolls (inner overflow container vs window), the movement probe demotes
// non-moving candidates, and 3 consecutive no-op scrolls stop the engine
// honestly instead of livelocking.
// Run: node test/scroll-root-harness.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

let contentSrc = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content.js'), 'utf8');
const _iifeEnd = contentSrc.lastIndexOf('})();');
contentSrc = contentSrc.slice(0, _iifeEnd) +
  '\n;try { window.__saicTest = { AutomationEngine: AutomationEngine, findScrollRootCandidates: findScrollRootCandidates, platformConfig: platformConfig }; } catch (e) {}\n' +
  contentSrc.slice(_iifeEnd);

function boot(fixtureHtml, url) {
  const dom = new JSDOM(fixtureHtml, {
    url: url || 'https://www.linkedin.com/feed/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  window.chrome = {
    runtime: {
      id: 'test-ext',
      onMessage: { addListener: () => {} },
      sendMessage: (msg, cb) => setTimeout(() => cb && cb({ platforms: {}, platformSettings: {}, contexts: [], priorityTargets: [] }), 0),
      lastError: null
    },
    storage: {
      local: { get: (k, cb) => setTimeout(() => cb && cb({}), 0), set: (o, cb) => cb && setTimeout(cb, 0), remove: (k, cb) => cb && setTimeout(cb, 0) },
      onChanged: { addListener: () => {} }
    }
  };
  try {
    Object.defineProperty(window.HTMLElement.prototype, 'innerText', { configurable: true, get: function () { return this.textContent; } });
  } catch (e) {}
  vm.runInContext(contentSrc, dom.getInternalVMContext(), { filename: 'content.js' });
  return window;
}

// content.js resolves platformConfig asynchronously (chrome.storage callback),
// so any engine call before this wait would cache a window-only scroll
// controller. In production the engine only starts long after init.
async function bootReady(fixtureHtml, url) {
  const win = boot(fixtureHtml, url);
  await new Promise(r => setTimeout(r, 300));
  return win;
}

// jsdom has no layout: stub the metrics a real browser would derive, the way
// the live 2026 LinkedIn feed really looks (window frozen, #workspace scrolls).
// jsdom's Element.scrollTop silently ignores writes (always reads 0), so a
// container that should scroll gets a real stored property instead.
function stubScrollMetrics(win, el, scrollHeight, clientHeight) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
  void win;
}
function stubLiveScrollTop(el) {
  let st = 0;
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => st, set: v => { st = v; } });
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

(async function run() {
  // ── 1. Inner-container feed (the live LinkedIn 2026 layout) ──
  console.log('fixture 1: inner overflow container scrolls the feed');
  {
    const win = await bootReady('<main id="workspace" style="overflow-y: scroll"><div data-testid="mainFeed" role="list"><div role="listitem">post</div></div></main>');
    const doc = win.document;
    stubScrollMetrics(win, doc.getElementById('workspace'), 4389, 533);
    stubLiveScrollTop(doc.getElementById('workspace'));
    const docEl = doc.documentElement;
    stubScrollMetrics(win, docEl, 600, 600); // window itself not scrollable

    let windowScrollCalls = 0;
    win.scrollTo = function () { windowScrollCalls++; };

    const T = win.__saicTest;
    const cands = T.findScrollRootCandidates(doc.querySelector('[role="listitem"]'));
    check('resolver returns #workspace first, root last',
      cands.length === 2 && cands[0] === doc.getElementById('workspace') && cands[1] === docEl,
      cands.map(c => c.id || c.tagName).join(','));

    T.AutomationEngine.state = 'running';
    await new Promise(res => T.AutomationEngine.humanScroll(800, res));
    check('humanScroll scrolled #workspace', doc.getElementById('workspace').scrollTop > 400, 'scrollTop=' + doc.getElementById('workspace').scrollTop);
    check('window.scrollTo never used when container scrolls', windowScrollCalls === 0, 'calls=' + windowScrollCalls);
    check('stuck counter reset on success', T.AutomationEngine._stuckScrolls === 0);
  }

  // ── 2. Window-scrolled feed (X/Reddit/Facebook layout) ──
  console.log('fixture 2: window scrolls the feed');
  {
    const win = await bootReady('<div role="feed"><article>post</article></div>');
    const doc = win.document;
    stubScrollMetrics(win, doc.documentElement, 9000, 600);
    let windowScrollCalls = 0, lastY = -1;
    win.scrollTo = function (x, y) { windowScrollCalls++; lastY = y; win.__y = y; };
    Object.defineProperty(win, 'scrollY', { configurable: true, get: function () { return this.__y || 0; } });

    const T = win.__saicTest;
    const cands = T.findScrollRootCandidates(doc.querySelector('article'));
    check('resolver falls back to the document root', cands.length === 1 && cands[0] === doc.documentElement);

    T.AutomationEngine.state = 'running';
    await new Promise(res => T.AutomationEngine.humanScroll(700, res));
    check('humanScroll used window.scrollTo', windowScrollCalls > 0, 'calls=' + windowScrollCalls);
    check('final position near target', Math.abs(lastY - 700) <= 120, 'lastY=' + lastY);
  }

  // ── 3. Movement probe demotes a dead inner candidate ──
  console.log('fixture 3: inner candidate ignores writes → probe falls through to window');
  {
    const win = await bootReady('<main id="workspace" style="overflow-y: scroll"><div data-testid="mainFeed"><div role="listitem">post</div></div></main>');
    const doc = win.document;
    const ws = doc.getElementById('workspace');
    stubScrollMetrics(win, ws, 4389, 533);
    stubScrollMetrics(win, doc.documentElement, 9000, 600);
    // scrollTop setter that silently ignores writes (dead container)
    Object.defineProperty(ws, 'scrollTop', { configurable: true, get: () => 0, set: () => {} });

    let windowScrollCalls = 0, winY = 0;
    win.scrollTo = function (x, y) { windowScrollCalls++; winY = y; };
    Object.defineProperty(win, 'scrollY', { configurable: true, get: () => winY });

    const T = win.__saicTest;
    T.AutomationEngine.state = 'running';
    await new Promise(res => T.AutomationEngine.humanScroll(600, res));
    check('probe advanced past the dead container', windowScrollCalls > 0, 'window calls=' + windowScrollCalls);
    check('scroll completed via window', winY > 300, 'winY=' + winY);
  }

  // ── 4. Nothing moves → honest stop after 3 stuck scrolls ──
  console.log('fixture 4: nothing scrolls → engine stops honestly');
  {
    const win = await bootReady('<div><article>post</article></div>');
    const doc = win.document;
    stubScrollMetrics(win, doc.documentElement, 9000, 600);
    win.scrollTo = function () {}; // no-op: window refuses to move
    Object.defineProperty(win, 'scrollY', { configurable: true, get: () => 0 });

    const T = win.__saicTest;
    const eng = T.AutomationEngine;
    eng.state = 'running';
    await new Promise(res => eng.humanScroll(500, res));
    await new Promise(res => eng.humanScroll(1000, res));
    check('2 stuck scrolls do not stop the engine', eng.state === 'running' && eng._stuckScrolls === 2, 'state=' + eng.state + ' stuck=' + eng._stuckScrolls);
    await new Promise(res => eng.humanScroll(1500, res));
    check('3rd stuck scroll stops the engine', eng.state === 'stopped', 'state=' + eng.state);
    const lastLog = eng.logEntries[eng.logEntries.length - 1] || '';
    check('stop reason names the scroll failure', /did not scroll/i.test(lastLog), lastLog);
  }

  // ── 5. Already at the bottom → honest "end of feed", no dead probing ──
  console.log('fixture 5: at the bottom of a exhausted feed → honest stop');
  {
    const win = await bootReady('<main id="workspace" style="overflow-y: scroll"><div data-testid="mainFeed"><div role="listitem">post</div></div></main>');
    const doc = win.document;
    const ws = doc.getElementById('workspace');
    stubScrollMetrics(win, ws, 2000, 600);
    stubLiveScrollTop(ws);
    ws.scrollTop = 1400; // max scroll = 1400 → already at the bottom

    const T = win.__saicTest;
    const eng = T.AutomationEngine;
    eng.state = 'running';
    let windowScrollCalls = 0;
    win.scrollTo = function () { windowScrollCalls++; };
    await new Promise(res => eng.humanScroll(2000, res));
    check('bottom-reached counts as stuck 1 without stopping', eng.state === 'running' && eng._stuckScrolls === 1,
      'state=' + eng.state + ' stuck=' + eng._stuckScrolls);
    await new Promise(res => eng.humanScroll(2200, res));
    await new Promise(res => eng.humanScroll(2400, res));
    check('3rd bottom-reach stops the engine', eng.state === 'stopped', 'state=' + eng.state);
    const lastLog = eng.logEntries[eng.logEntries.length - 1] || '';
    check('stop reason names the end of the feed', /end of the feed/i.test(lastLog), lastLog);
    check('no dead-root probing at the bottom (window never touched)', windowScrollCalls === 0, 'calls=' + windowScrollCalls);
  }

  console.log('\n== Results: ' + pass + ' passed, ' + fail + ' failed ==');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
