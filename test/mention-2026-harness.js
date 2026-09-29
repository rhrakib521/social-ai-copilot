// Focused test: 2026 mention dropdown detection + selection + verification.
//   1. listbox descriptor detection (2026 primary signal) + descriptor click
//      picks the matching option, never a decoy; single-option trust rule
//   2. portal snapshot-diff detection (markup-agnostic) + relaxed token match
//   3. announcer detection (pre-2026) incl. "0 suggestions" negative
//   4. Strategy-3 brute force never clicks the composer, its ancestors, or
//      .tiptap/.ProseMirror decoys
//   5. verifyMentionInserted: chip success, honest plain-text failure
//   6. end-to-end insertMention → dropdown → click → chip verification
// Run: node test/mention-2026-harness.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

let contentSrc = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content.js'), 'utf8');
const _iifeEnd = contentSrc.lastIndexOf('})();');
contentSrc = contentSrc.slice(0, _iifeEnd) +
  '\n;try { window.__saicTest = { AutomationEngine: AutomationEngine }; } catch (e) {}\n' +
  contentSrc.slice(_iifeEnd);

const FIXTURE = `
<main id="workspace" style="overflow-y: scroll">
  <div role="list" data-testid="mainFeed">
    <div role="listitem" id="post-1">
      <a href="/in/author1/"><span>Author One</span></a>
      <div data-testid="expandable-text-box">Excited to share our Q3 numbers grew 40% quarter over quarter with zero paid spend.</div>
      <button aria-label="Comment">14</button>
      <div id="composer-area">
        <div class="tiptap ProseMirror" id="field" contenteditable="true" aria-label="Text editor for creating comment"><p data-placeholder="Add a comment..."></p></div>
      </div>
    </div>
  </div>
</main>`;

const dom = new JSDOM(FIXTURE, {
  url: 'https://www.linkedin.com/feed/', runScripts: 'outside-only', pretendToBeVisual: true
});
const { window } = dom;
const doc = window.document;
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

// jsdom has no layout engine — make Strategy-3 visibility checks pass.
// offsetParent must be null at body/html or offset-chain walks never terminate.
Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { configurable: true, get: function () { return (this === doc.body || this === doc.documentElement) ? null : doc.body; } });
Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get: function () { return 24; } });

// jsdom does not implement PointerEvent (real Chrome does) — click sequences need it
if (!window.PointerEvent) {
  window.PointerEvent = function PointerEventPolyfill(type, init) {
    return new window.MouseEvent(type, init);
  };
}

// jsdom does not implement execCommand — route typed text into the active test field
var execTarget = null;
doc.execCommand = function (cmd, ui, text) {
  if (cmd === 'insertText' && typeof text === 'string' && execTarget) { execTarget.textContent += text; return true; }
  return false;
};

vm.runInContext(contentSrc, dom.getInternalVMContext(), { filename: 'content.js' });

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async function run() {
  await wait(300); // async platformConfig init
  const T = window.__saicTest;
  const eng = T.AutomationEngine;
  eng.state = 'running';
  const field = doc.getElementById('field');
  const composer = doc.getElementById('composer-area');
  const post = doc.getElementById('post-1');
  execTarget = field;

  // ── 1. Listbox descriptor (2026 primary signal) ──
  console.log('listbox detection:');
  const snap = eng.captureMentionSnapshot(field);
  const lb = doc.createElement('div');
  lb.setAttribute('role', 'listbox');
  const optionTexts = ['Acme', 'Acme Labs', 'Other Co'];
  const clickedTexts = [];
  optionTexts.forEach(function (t) {
    const o = doc.createElement('div');
    o.setAttribute('role', 'option');
    o.textContent = t;
    o.addEventListener('click', function () { clickedTexts.push(t); });
    lb.appendChild(o);
  });
  composer.appendChild(lb);

  const desc = eng.checkMentionResults(field, snap);
  check('descriptor found via listbox', !!desc && desc.how === 'listbox', desc && desc.how);
  check('all text-bearing options collected', desc && desc.options.length === 3, desc && String(desc.options.length));
  check('root is the listbox', desc && desc.root === lb);

  await new Promise(res => eng.clickMentionResult(field, desc, 'Acme', res));
  check('clicked the exact-match option', clickedTexts.length === 1 && clickedTexts[0] === 'Acme', JSON.stringify(clickedTexts));

  // Single-option listbox is trusted even without a text match
  lb.remove();
  const lb1 = doc.createElement('div');
  lb1.setAttribute('role', 'listbox');
  const solo = doc.createElement('div');
  solo.setAttribute('role', 'option');
  solo.textContent = 'Totally Different Ltd';
  let soloClicked = false;
  solo.addEventListener('click', function () { soloClicked = true; });
  lb1.appendChild(solo);
  composer.appendChild(lb1);
  const desc1 = eng.checkMentionResults(field, snap);
  await new Promise(res => eng.clickMentionResult(field, desc1, 'Acme', res));
  check('single-option listbox trusted', soloClicked === true);
  lb1.remove();

  // ── 2. Portal snapshot-diff (no role attributes at all) ──
  console.log('portal-diff detection:');
  const snap2 = eng.captureMentionSnapshot(field);
  const portal = doc.createElement('div');
  portal.className = 'x7a8b9c'; // hashed class, no a11y roles
  [['Acme AI', 'acme'], ['Beta Corp', 'beta']].forEach(function (pair) {
    const row = doc.createElement('div');
    const avatar = doc.createElement('img');
    const label = doc.createElement('span');
    label.textContent = pair[0];
    label.setAttribute('data-name', pair[0]);
    row.appendChild(avatar); row.appendChild(label);
    row.addEventListener('click', function () { clickedTexts.push(pair[0]); });
    portal.appendChild(row);
  });
  composer.appendChild(portal);

  const desc2 = eng.checkMentionResults(field, snap2);
  check('descriptor found via portal diff', !!desc2 && desc2.how === 'portal', desc2 && desc2.how);
  check('portal options are the leaf labels', desc2 && desc2.options.length === 2 &&
    desc2.options.every(o => o.tagName === 'SPAN'), desc2 && desc2.options.map(o => o.tagName).join(','));
  await new Promise(res => eng.clickMentionResult(field, desc2, 'Acme AI Technologies', res));
  check('relaxed first-token match clicked "Acme AI"', clickedTexts[clickedTexts.length - 1] === 'Acme AI',
    JSON.stringify(clickedTexts));
  portal.remove();

  // ── 3. Announcer (pre-2026 markup) ──
  console.log('announcer detection:');
  const taHost = doc.createElement('div');
  taHost.className = 'typeahead-results';
  const announcer = doc.createElement('div');
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-label', '2 suggestions found for query: Acme');
  const ul = doc.createElement('ul');
  ['Acme', 'Acme Labs'].forEach(function (t) {
    const li = doc.createElement('li'); li.textContent = t; ul.appendChild(li);
  });
  taHost.appendChild(announcer); taHost.appendChild(ul);
  composer.appendChild(taHost);
  const desc3 = eng.checkMentionResults(field, null);
  check('descriptor found via announcer', !!desc3 && desc3.how === 'announcer', desc3 && desc3.how);
  check('announcer options extracted', desc3 && desc3.options.length === 2);
  announcer.setAttribute('aria-label', '0 suggestions found for query: Acme');
  check('"0 suggestions" is a negative', eng.checkMentionResults(field, null) === null);
  taHost.remove();

  // ── 4. Strategy-3 decoy guard ──
  console.log('strategy-3 decoy guard:');
  field.textContent = '@Acme unsubmitted draft';
  const decoys = [];
  [['div', 'tiptap'], ['div', 'ProseMirror'], ['div', 'ql-editor'], ['div', 'feed-shared-update-v2']].forEach(function (pair) {
    const d = doc.createElement(pair[0]);
    d.className = pair[1]; d.textContent = 'Acme';
    d.addEventListener('click', function () { decoys.push(pair[1]); });
    post.appendChild(d);
  });
  const realTarget = doc.createElement('div');
  realTarget.textContent = 'Acme — Software Company';
  let realClicked = false;
  realTarget.addEventListener('click', function () { realClicked = true; });
  post.appendChild(realTarget);
  const composerClicks = [];
  [field, composer, post].forEach(function (el) {
    // capture phase + event.target: detect being the actual click target
    // (a click on a child legitimately bubbles to ancestors)
    el.addEventListener('click', function (ev) {
      if (ev.target === el) composerClicks.push(el.id || el.className);
    });
  });
  await new Promise(res => eng.clickMentionResult(field, null, 'Acme', res));
  check('real target clicked', realClicked === true);
  check('no decoy class clicked', decoys.length === 0, JSON.stringify(decoys));
  check('composer/ancestors never clicked', composerClicks.length === 0, JSON.stringify(composerClicks));
  decoys.forEach(function () {}); // (decoys asserted above)
  // clean up decoys
  Array.prototype.slice.call(post.children).forEach(function (ch) {
    if (ch !== composer && ch !== realTarget && ch.id !== 'field' &&
        ch.tagName === 'DIV' && ch.getAttribute('data-testid') !== 'expandable-text-box') ch.remove();
  });
  realTarget.remove();

  // ── 5. verifyMentionInserted ──
  console.log('verifyMentionInserted:');
  field.textContent = 'Great post @Acme thanks';
  const beforeChips = eng.countMentionChips(field);
  let verifyOk = null;
  eng.verifyMentionInserted(field, 'Acme', beforeChips, function (ok) { verifyOk = ok; });
  await wait(600); // chip renders a beat after the click
  const chip = doc.createElement('span');
  chip.setAttribute('data-entity-type', 'COMPANY');
  chip.setAttribute('data-id', 'urn:li:company:12345');
  chip.textContent = 'Acme';
  field.textContent = 'Great post  thanks'; // literal "@acme" replaced
  field.appendChild(chip);
  await wait(2500);
  check('chip insertion verified true', verifyOk === true, 'verifyOk=' + verifyOk);

  field.textContent = 'Nice one @Acme plain text';
  let verifyFail = null;
  eng.verifyMentionInserted(field, 'Acme', eng.countMentionChips(field), function (ok) { verifyFail = ok; });
  await wait(2600);
  check('plain text honestly verified false', verifyFail === false, 'verifyFail=' + verifyFail);
  check('engine still running after honest failure', eng.state === 'running');

  // ── 6. End-to-end insertMention ──
  console.log('end-to-end insertMention:');
  field.textContent = '';
  let e2eDone = false;
  // Simulate the 2026 dropdown: appears shortly after "@" is typed
  setTimeout(function () {
    const e2eLb = doc.createElement('div');
    e2eLb.setAttribute('role', 'listbox');
    const opt = doc.createElement('div');
    opt.setAttribute('role', 'option');
    opt.textContent = 'Acme — Company';
    opt.addEventListener('click', function () {
      // LinkedIn replaces the raw query with a mention chip node
      field.textContent = field.textContent.replace('@Acme', '');
      const c = doc.createElement('span');
      c.setAttribute('data-entity-type', 'COMPANY');
      c.setAttribute('data-id', 'urn:li:company:777');
      c.textContent = 'Acme';
      field.appendChild(c);
      e2eLb.remove();
    });
    e2eLb.appendChild(opt);
    composer.appendChild(e2eLb);
  }, 300);

  await Promise.race([
    new Promise(function (res) { eng.insertMention(field, 'Acme', function () { e2eDone = true; res(); }); }),
    wait(10000)
  ]);
  check('insertMention completed', e2eDone === true);
  check('literal "@acme" gone from composer', (field.textContent || '').toLowerCase().indexOf('@acme') === -1,
    '"' + field.textContent + '"');
  check('mention chip present in field', field.querySelector('[data-entity-type="COMPANY"]') !== null);
  check('engine still running after mention flow', eng.state === 'running');

  console.log('\n== Results: ' + pass + ' passed, ' + fail + ' failed ==');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
