// LIVE launcher: boots a debug Chrome with CDP on :9223, loads the unpacked
// extension, and opens an initial tab. Idempotent — if Chrome is already up
// on the port it just (re)loads the extension and reuses the session, so the
// login state in the profile persists across runs.
// Run: node test/live-launch.js [url]
//
// Flags used:
//   --remote-debugging-port=9223        CDP endpoint
//   --enable-unsafe-extension-debugging  required for Extensions.loadUnpacked
//                                        and service-worker debugging on Chrome 153+
//   --user-data-dir                     persistent temp profile (keeps logins)

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = process.env.SAIC_DEBUG_PORT || 9223;
const PROFILE = process.env.SAIC_PROFILE || path.join(os.tmpdir(), 'saic-live-profile');
const EXT_PATH = path.join(__dirname, '..', 'extension').replace(/\\/g, '/');
const initialUrl = process.argv[2] || 'https://www.linkedin.com/feed/';

function chromeCandidates() {
  const out = [];
  const pf = [
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
  ];
  for (const p of pf) if (p && fs.existsSync(p)) out.push(p);
  return out;
}

async function isUp() {
  try {
    const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    return v;
  } catch (e) { return null; }
}

async function waitUp(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await isUp();
    if (v) return v;
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('Chrome CDP did not come up on port ' + PORT);
}

// Load the extension exactly once. Re-running Extensions.loadUnpacked while a
// copy is already loaded creates a SECOND copy (new id, same content scripts →
// duplicate panels, split chrome.storage, panels reading stale settings). So:
// reuse an existing copy only when its code matches the on-disk build; refuse
// to stack a fresh copy on top of a stale one (restart Chrome instead).
async function loadExtension(send) {
  // Markers only present in the current build (updated when content.js changes shape)
  const MARKERS = ['end of the feed', 'fieldBelongsToPost', 'findScrollRootCandidates'];
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const sws = targets.filter(t => t.type === 'service_worker' && /^chrome-extension:\/\//.test(t.url));
  for (const sw of sws) {
    try {
      const swWs = new WebSocket(sw.webSocketDebuggerUrl);
      await new Promise((res, rej) => { swWs.onopen = res; swWs.onerror = rej; });
      const r = await new Promise((res2, rej2) => {
        const to = setTimeout(() => rej2(new Error('SW probe timeout')), 10000);
        swWs.onmessage = ev => {
          const m = JSON.parse(ev.data);
          if (m.id === 1) { clearTimeout(to); swWs.onmessage = null; m.error ? rej2(new Error(m.error.message)) : res2(m.result); }
        };
        swWs.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `(async () => { const t = await (await fetch(chrome.runtime.getURL('content.js'))).text(); return { id: chrome.runtime.id, markers: ${JSON.stringify(MARKERS)}.filter(m => t.includes(m)).length }; })()`, awaitPromise: true, returnByValue: true } }));
      });
      swWs.close();
      const v = r.result && r.result.value;
      if (v && v.markers === MARKERS.length) {
        console.log('Reusing loaded extension copy:', v.id, '(code matches disk)');
        return { id: v.id };
      }
      console.log('Stale extension copy present:', v && v.id, `(${v && v.markers}/${MARKERS.length} current markers) — kill Chrome and re-run for a clean load`);
      process.exit(1);
    } catch (e) { /* SW not probeable — try next */ }
  }
  const extId = await send('Extensions.loadUnpacked', { path: EXT_PATH });
  return extId;
}

async function main() {
  let ver = await isUp();
  if (!ver) {
    const exe = chromeCandidates()[0];
    if (!exe) throw new Error('Chrome not found in standard locations');
    console.log('Launching:', exe);
    console.log('Profile:', PROFILE);
    // Detached + own console suppressed; keepalive so it survives this process.
    const child = spawn(exe, [
      '--remote-debugging-port=' + PORT,
      '--enable-unsafe-extension-debugging',
      '--user-data-dir=' + PROFILE,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank'
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    ver = await waitUp();
  }
  console.log('Chrome up:', ver.Browser);

  // Browser-target WS → Extensions.loadUnpacked. NOTE: unpacked copies DO
  // persist in this profile across Chrome restarts (Chrome 153) — loadExtension
  // below refuses to stack a second copy when one already serves current code.
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  };
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 20000);
    });
  }

  const extId = await loadExtension(send);
  console.log('Extension ready:', extId.id);

  // Target list — for /json/new PUT (Chrome 111+ requires PUT).
  const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const blank = tabs.find(t => t.type === 'page' && /about:blank/.test(t.url));
  if (blank) {
    await fetch(`http://127.0.0.1:${PORT}/json/activate?${blank.id}`, { method: 'PUT' }).catch(() => {});
  }
  console.log('Open tabs:', tabs.filter(t => t.type === 'page').map(t => t.url.slice(0, 60)));
  console.log('\nNavigate the debug Chrome to: ' + initialUrl);
  console.log('Service worker target (for storage writes):');
  const sw = tabs.find(t => t.type === 'service_worker');
  console.log(sw ? '  ' + sw.url : '  (none yet — spawns on extension activity)');
  ws.close();
}

main().catch(e => { console.error('LAUNCH ERROR:', e.message); process.exit(1); });
