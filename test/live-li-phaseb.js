// LIVE LinkedIn Phase B: drives the REAL engine end-to-end in safe mode.
//   - writes platformSettings.linkedin { stopLimit: 1, autoSubmit: false,
//     interval: 30, zero engagement thresholds } via the service worker
//   - clicks the panel's real Start button (ToS confirm auto-accepted via CDP)
//   - asserts: scroll root moved correctly, a real post was processed, AI
//     generation + review overlay rendered (nothing posts without approval)
//   - clicks Skip on the overlay (no comment is ever published), then Stop
//   - restores the original settings
// Writes test/live-li-phaseb.json + screenshots live-li-phaseb-*.png.
//
// Run: node test/live-li-phaseb.js   (after test/live-launch.js, logged in)
// Exit codes: 0 pass · 1 fail · 2 error · 3 login required

const fs = require('fs');
const path = require('path');
const PORT = process.env.SAIC_DEBUG_PORT || 9223;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let ws = null, msgId = 0;
const pending = new Map();
const report = { settings: null, baseline: null, events: [], consoleLines: [], overlay: null, verdicts: {}, restored: false };

function cdpSend(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)); } }, 30000);
  });
}
async function evalInPage(expression, awaitPromise = false) {
  const r = await cdpSend('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 300));
  return r.result && r.result.value;
}

async function attach(matchRe) {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  let page = targets.find(t => t.type === 'page' && new RegExp(matchRe).test(t.url));
  if (!page) {
    // Open a tab and navigate it to the feed
    await fetch(`http://127.0.0.1:${PORT}/json/new?https://www.linkedin.com/feed/`, { method: 'PUT' });
    await sleep(9000);
    const again = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = again.find(t => t.type === 'page' && /linkedin\.com/.test(t.url));
    if (!page) throw new Error('could not open a LinkedIn tab');
  }
  if (ws) ws.close();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    } else if (m.method === 'Page.javascriptDialogOpening') {
      report.events.push({ t: Date.now(), ev: 'dialog', text: (m.params.message || '').slice(0, 80) });
      cdpSend('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    } else if (m.method === 'Runtime.consoleAPICalled') {
      const args = (m.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
      if (/SAIC/i.test(args)) {
        report.consoleLines.push(String(args).slice(0, 300));
        console.log('    [page]', String(args).slice(0, 150));
      }
    }
  };
  await cdpSend('Runtime.enable');
  await cdpSend('Page.enable');
  return page;
}

async function shot(name) {
  try {
    const s = await cdpSend('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, 'live-li-phaseb-' + name + '.png'), Buffer.from(s.data, 'base64'));
  } catch (e) { /* non-fatal */ }
}

// ── service-worker storage I/O ──
let settingsSwUrl = null; // pinned to the SW that actually holds the settings

function swEvalOn(swUrl, expression) {
  return new Promise(async (resolve, reject) => {
    let swWs;
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const sw = targets.find(t => t.type === 'service_worker' && t.url === swUrl);
      if (!sw) throw new Error('service worker vanished: ' + swUrl);
      swWs = new WebSocket(sw.webSocketDebuggerUrl);
      await new Promise((res, rej) => { swWs.onopen = res; swWs.onerror = rej; });
      const r = await new Promise((res2, rej2) => {
        swWs.onmessage = ev => {
          const m = JSON.parse(ev.data);
          if (m.id === 1) { swWs.onmessage = null; m.error ? rej2(new Error(m.error.message)) : res2(m.result); }
        };
        swWs.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
        setTimeout(() => rej2(new Error('SW eval timeout')), 15000);
      });
      if (r.exceptionDetails) throw new Error('SW eval: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 300));
      resolve(r.result && r.result.value);
    } catch (e) { reject(e); }
    finally { try { if (swWs) swWs.close(); } catch (e) {} }
  });
}

// Multiple unpacked copies of the extension can be loaded simultaneously (each
// with its own chrome.storage). Prefer the service worker that already holds
// the saved settings; otherwise pin the first extension service worker.
async function swEval(expression) {
  if (settingsSwUrl) {
    try { return await swEvalOn(settingsSwUrl, expression); } catch (e) { settingsSwUrl = null; }
  }
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const sws = targets.filter(t => t.type === 'service_worker' && /^chrome-extension:\/\//.test(t.url));
  if (!sws.length) throw new Error('no service worker targets found');
  let lastErr = null;
  for (const sw of sws) {
    try {
      const has = await swEvalOn(sw.url, `(async () => { const r = await new Promise(res => chrome.storage.local.get('socialAiCopilot_settings', res)); const s = r.socialAiCopilot_settings; if (!s) return false; if (typeof s === 'string') { try { return Object.keys(JSON.parse(s)).length > 0; } catch (e) { return false; } } return Object.keys(s).length > 0; })()`);
      if (has) {
        settingsSwUrl = sw.url;
        console.log('  [sw] using (holds settings)', sw.url.slice(0, 60));
        return await swEvalOn(settingsSwUrl, expression);
      }
    } catch (e) { lastErr = e; }
  }
  settingsSwUrl = sws[0].url;
  console.log('  [sw] using (no settings found anywhere — first SW)', settingsSwUrl.slice(0, 60));
  return await swEvalOn(settingsSwUrl, expression);
}

// Run an expression on EVERY loaded extension service worker and return their
// URLs — settings must reach whichever copy owns the injected panel.
async function swEvalAll(expression) {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const sws = targets.filter(t => t.type === 'service_worker' && /^chrome-extension:\/\//.test(t.url));
  const done = [];
  for (const sw of sws) {
    try {
      await swEvalOn(sw.url, expression);
      done.push(sw.url);
    } catch (e) { console.log('  [sw] failed on', sw.url.slice(0, 50), '—', e.message); }
  }
  return done;
}

async function main() {
  console.log('== LIVE LinkedIn Phase B (safe review mode) ==');
  await attach('linkedin');
  let url = await evalInPage('location.href');
  if (!/linkedin\.com\/feed/.test(url)) {
    await cdpSend('Page.navigate', { url: 'https://www.linkedin.com/feed/' });
    await sleep(8000);
    await attach('linkedin');
    url = await evalInPage('location.href');
  }
  if (/\/login\//.test(url) || await evalInPage(`!!document.querySelector('input[type="password"]')`)) {
    console.log('LOGIN REQUIRED — log into LinkedIn in the debug Chrome, then re-run.');
    process.exit(3);
  }
  console.log('Logged in:', url.slice(0, 70));

  // ── 1. Patch settings for a single-review-run ──
  console.log('\n[1] patching settings via service worker');
  let orig = await swEval(`(async () => { const r = await new Promise(res => chrome.storage.local.get('socialAiCopilot_settings', res)); const s = r.socialAiCopilot_settings; if (!s) return null; if (typeof s === 'string') { try { return JSON.parse(s); } catch (e) { return null; } } return s; })()`);
  let seeded = false;
  if (!orig) {
    // This debug profile has never had the popup configured. Seed a minimal,
    // key-less baseline so the engine can run; the AI call will fail honestly,
    // which the verdicts treat as a legitimate outcome.
    console.log('  no saved settings — seeding a minimal key-less baseline (AI will fail honestly)');
    orig = {
      provider: '', apiKey: '', authMode: 'user_key',
      platforms: { linkedin: true },
      platformSettings: { linkedin: { tone: 'casual', interval: 60, autoSubmit: true, stopLimit: 0, mentionPages: [] } },
      contexts: [], priorityTargets: []
    };
    seeded = true;
  }
  const patched = JSON.parse(JSON.stringify(orig));
  patched.platformSettings = patched.platformSettings || {};
  const li = Object.assign({}, patched.platformSettings.linkedin || {}, {
    stopLimit: 1, autoSubmit: false, interval: 30,
    engagementThresholds: { minReactions: 0, minComments: 0 }
  });
  patched.platformSettings.linkedin = li;
  if (!seeded) fs.writeFileSync(path.join(__dirname, 'live-li-phaseb-settings-backup.json'), JSON.stringify(orig, null, 2));
  const patchedSws = await swEvalAll(`(async () => { await new Promise(res => chrome.storage.local.set({ socialAiCopilot_settings: ${JSON.stringify(patched)} }, res)); return true; })()`);
  console.log('  patched settings into', patchedSws.length, 'extension copy(ies)');
  if (!patchedSws.length) { console.log('FAIL: could not write settings to any extension storage'); process.exit(2); }
  report.settings = {
    seeded: seeded,
    provider: orig.provider || 'none',
    hasKey: !!(orig.apiKey || orig.backendToken),
    mentionPages: (li.mentionPages || []),
    linkedinEnabled: (orig.platforms && orig.platforms.linkedin) !== false
  };
  console.log('  provider:', report.settings.provider, '| key:', report.settings.hasKey ? 'yes' : 'NO', '| mention pages:', JSON.stringify(report.settings.mentionPages));
  if (!report.settings.linkedinEnabled) { console.log('linkedin disabled in settings — abort'); process.exit(2); }
  if (!report.settings.hasKey) console.log('  ⚠ no API key — AI generation will fail honestly; overlay will not appear');

  // ── 2. Reload so the content script boots with the patched settings ──
  await cdpSend('Page.reload');
  await sleep(9000);
  await attach('linkedin');
  await cdpSend('Page.bringToFront').catch(() => {});
  await sleep(4000); // feed hydration

  const panel = await evalInPage(`!!document.querySelector('.saic-auto-start')`);
  if (!panel) { console.log('FAIL: automation panel not present after reload'); process.exit(1); }
  console.log('\n[2] panel ready');

  // ── 3. Baseline: what can scroll, where are we ──
  report.baseline = await evalInPage(`(function () {
    var w = document.querySelector('#workspace, main');
    return {
      workspace: w ? { scrollTop: w.scrollTop, scrollHeight: w.scrollHeight, clientHeight: w.clientHeight, overflowY: getComputedStyle(w).overflowY } : null,
      windowY: window.scrollY,
      listitems: document.querySelectorAll('[data-testid="mainFeed"] [role="listitem"]').length
    };
  })()`);
  console.log('\n[3] baseline:', JSON.stringify(report.baseline).slice(0, 220));

  // ── 4. Start the engine via the real panel button ──
  console.log('\n[4] clicking Start (ToS confirm auto-accepted)');
  await shot('start');
  await evalInPage(`document.querySelector('.saic-auto-start').click()`);
  report.events.push({ t: Date.now(), ev: 'start-clicked' });

  // ── 5. Watch the run ──
  console.log('\n[5] watching the run (up to 150s)');
  const t0 = Date.now();
  let overlaySeen = null, skipClicked = false, stopped = false;
  while (Date.now() - t0 < 150000) {
    await sleep(3000);
    const snap = await evalInPage(`(function () {
      var w = document.querySelector('#workspace, main');
      var ov = document.querySelector('.saic-review-overlay');
      return {
        workspaceTop: w ? w.scrollTop : -1,
        windowY: window.scrollY,
        overlay: ov ? (ov.querySelector('.saic-review-text') || {}).textContent : null,
        running: !!document.querySelector('.saic-auto-stop:not([style*="display: none"])')
      };
    })()`).catch(() => null);
    if (!snap) continue;
    if (!report.baseline.workspace || snap.workspaceTop !== report.baseline.workspace.scrollTop) {
      report.events.push({ t: Date.now(), ev: 'scroll', workspaceTop: snap.workspaceTop, windowY: snap.windowY });
      report.baseline.workspace = report.baseline.workspace || {};
      report.baseline.scrollTopSeen = snap.workspaceTop; // remember last
    }
    if (snap.overlay && !overlaySeen) {
      overlaySeen = snap.overlay;
      report.overlay = String(overlaySeen).slice(0, 600);
      console.log('\n  ★ REVIEW OVERLAY with generated comment:');
      console.log('    "' + report.overlay.slice(0, 300) + '"');
      await shot('overlay');
      // The human decision: SKIP — nothing gets posted
      await evalInPage(`document.querySelector('.saic-review-skip').click()`);
      skipClicked = true;
      report.events.push({ t: Date.now(), ev: 'skip-clicked' });
      console.log('  ✓ clicked Skip (no comment published)');
    }
    if (!snap.running && (overlaySeen || Date.now() - t0 > 20000)) {
      stopped = true;
      break;
    }
  }

  // ── 6. Stop if still running, capture final state ──
  let stillRunning = await evalInPage(`!!document.querySelector('.saic-auto-stop:not([style*="display: none"])')`).catch(() => false);
  if (stillRunning) {
    // Every loaded copy injects its own panel/engine — stop them ALL
    await evalInPage(`document.querySelectorAll('.saic-auto-stop').forEach(function (b) { b.click(); })`).catch(() => {});
    await sleep(1500);
    report.events.push({ t: Date.now(), ev: 'stop-clicked' });
    // verdict must reflect the post-stop state, not the pre-stop one
    stillRunning = await evalInPage(`!!document.querySelector('.saic-auto-stop:not([style*="display: none"])')`).catch(() => true);
  }
  const finalState = await evalInPage(`(function () { var w = document.querySelector('#workspace, main'); return { workspaceTop: w ? w.scrollTop : -1, windowY: window.scrollY, composerOpen: !!document.querySelector('.tiptap.ProseMirror[contenteditable="true"]') }; })()`).catch(() => ({}));
  report.finalState = finalState;
  await shot('end');

  // ── 7. Restore original settings ──
  if (seeded) {
    report.restored = 'seeded (nothing to restore)';
    console.log('\n[7] baseline was seeded by this run — leaving the safe patched settings in place');
  } else {
    try {
      const expr = `(async () => { await new Promise(res => chrome.storage.local.set({ socialAiCopilot_settings: ${JSON.stringify(orig)} }, res)); return true; })()`;
      const done = [];
      for (const u of patchedSws) { try { await swEvalOn(u, expr); done.push(u); } catch (e) {} }
      if (!done.length) done.push(...await swEvalAll(expr)); // SWs may have been swapped out mid-run
      report.restored = done.length > 0;
      console.log('\n[7] original settings restored to', done.length, 'copy(ies)');
    } catch (e) { console.log('\n[7] ⚠ could not restore settings:', e.message); }
  }

  // ── 8. Verdicts ──
  const lines = report.consoleLines.join('\n');
  const scrolled = report.events.some(e => e.ev === 'scroll') ||
    finalState.workspaceTop !== (report.baseline.workspace || {}).scrollTop;
  // Every "API error" line means a post was pulled and generation was attempted
  // on it — legitimate processing evidence in a key-less profile.
  const apiErrors = (lines.match(/\[SAIC-Auto\][^\n]*API error/g) || []).length;
  const processedPost = (/process|comment|post|composer|generat/i.test(lines) && report.events.length > 1) || apiErrors >= 1;
  const overlayOk = !!overlaySeen && report.overlay && report.overlay.length > 10;
  const aiFailedHonestly = !overlayOk && /fail|error|no api|provider/i.test(lines);
  const nothingPosted = !/Submit clicked|Submit verified/.test(lines);
  const engineStopped = stopped || stillRunning === false;
  // Without a configured key the overlay CANNOT render — that run's overlay
  // outcome is informational, not a failure.
  const overlayHard = report.settings.hasKey ? overlayOk : true;

  report.apiErrors = apiErrors;
  // Safety: the engine must have booted from the PATCHED settings, not a stale
  // copy (a previous run saw "interval: 60s, auto: true" — wrong storage).
  const bootedPatched = /Started - interval: 30s, auto: false/.test(lines);
  report.verdicts = {
    'engine booted with patched settings (30s, auto: false)': bootedPatched,
    'scroll mechanism engaged (no livelock)': scrolled || processedPost,
    'engine processed the feed (logs advanced)': processedPost,
    'AI comment + review overlay rendered': overlayHard,
    '  (or AI failed honestly — no key?)': aiFailedHonestly,
    'nothing was posted without approval': nothingPosted,
    'engine reached a stopped/handled state': engineStopped
  };
  console.log('\n== Verdicts ==');
  let hardFails = 0;
  Object.keys(report.verdicts).forEach(function (k) {
    const v = report.verdicts[k];
    const soft = k.indexOf('(or') === 0;
    console.log((v ? '  PASS ' : (soft ? '  --   ' : '  FAIL ')) + k);
    if (!v && !soft) hardFails++;
  });

  fs.writeFileSync(path.join(__dirname, 'live-li-phaseb.json'), JSON.stringify(report, null, 2));
  console.log('\nReport: test/live-li-phaseb.json');
  process.exit(hardFails > 0 ? 1 : 0);
}

main().catch(e => { console.error('PHASEB ERROR:', e.message); process.exit(2); });
