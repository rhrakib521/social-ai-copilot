// Focused test: LinkedIn 2026 submit-button discovery in findAndClickSubmit.
//   1. legacy type="submit" still found via the platform selector
//   2. 2026 text-only "Comment" submit (empty aria-label) found via the text
//      fallback — the comment toggle (aria "Comment" + count) and a nested
//      comment "Reply" button are never picked instead
//   3. icon-only submit named by aria-label alone found via the aria fallback
//   4. with the submit absent, nothing else is clicked (honest false)
// Run: node test/linkedin-submit-harness.js

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
      <div id="action-bar">
        <button id="toggle" aria-label="Comment">14</button>
        <button aria-label="Repost">8</button>
      </div>
      <div id="nested-comment">
        <button id="reply-decoy">Reply</button>
      </div>
      <div id="composer-area">
        <div class="tiptap ProseMirror" id="field" contenteditable="true" aria-label="Text editor for creating comment"><p>Great insights, congrats!</p></div>
        <button id="submit"></button>
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
// jsdom has no layout: every element "visible" with a sane rect
Object.defineProperty(window.Element.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: function () { return { x: 10, y: 10, top: 10, bottom: 40, left: 10, right: 110, width: 100, height: 30 }; }
});

vm.runInContext(contentSrc, dom.getInternalVMContext(), { filename: 'content.js' });

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Each submit "click" behaves like LinkedIn: clears the composer
function armClickRecorders() {
  const clicks = [];
  ['submit', 'toggle', 'reply-decoy'].forEach(function (id) {
    const el = doc.getElementById(id);
    if (!el) return; // element removed for this case
    el.addEventListener('click', function () {
      clicks.push(id);
      if (id === 'submit') doc.getElementById('field').textContent = ''; // compose clears
    });
  });
  return clicks;
}

(async function run() {
  await wait(300); // async platformConfig init
  const T = window.__saicTest;
  const eng = T.AutomationEngine;
  eng.state = 'running';
  const post = doc.getElementById('post-1');
  const field = doc.getElementById('field');
  const submit = doc.getElementById('submit');
  const toggle = doc.getElementById('toggle');

  // ── 1. Legacy submit: type="submit" found via the platform selector ──
  console.log('legacy type=submit:');
  submit.setAttribute('type', 'submit');
  submit.textContent = 'Post';
  let clicks1 = armClickRecorders();
  let r1 = await new Promise(res => eng.findAndClickSubmit(post, field, res));
  check('legacy submit clicked', r1 === true && clicks1.indexOf('submit') !== -1, JSON.stringify({ r1, clicks1 }));
  submit.removeAttribute('type');

  // ── 2. 2026 text-only "Comment" submit (empty aria-label) ──
  console.log('2026 text-only submit:');
  field.textContent = 'Great insights, congrats!';
  submit.textContent = 'Comment';           // live 2026 submit: text only, no aria
  submit.removeAttribute('aria-label');
  eng._lastCommentBtn = toggle;             // the toggle we clicked to open this composer
  let clicks2 = armClickRecorders();
  let r2 = await new Promise(res => eng.findAndClickSubmit(post, field, res));
  check('text-only submit clicked', r2 === true && clicks2.indexOf('submit') !== -1, JSON.stringify({ r2, clicks2 }));
  check('comment toggle never clicked', clicks2.indexOf('toggle') === -1, JSON.stringify(clicks2));
  check('nested "Reply" decoy never clicked', clicks2.indexOf('reply-decoy') === -1, JSON.stringify(clicks2));

  // ── 3. Icon-only submit named by aria-label alone ──
  console.log('icon-only aria submit:');
  field.textContent = 'Great insights, congrats!';
  submit.textContent = '';                  // icon-only
  submit.setAttribute('aria-label', 'Comment');
  let clicks3 = armClickRecorders();
  let r3 = await new Promise(res => eng.findAndClickSubmit(post, field, res));
  check('aria-only submit clicked', r3 === true && clicks3.indexOf('submit') !== -1, JSON.stringify({ r3, clicks3 }));
  check('toggle still never clicked', clicks3.indexOf('toggle') === -1, JSON.stringify(clicks3));
  submit.removeAttribute('aria-label');

  // ── 4. Submit absent → honest false, nothing else clicked ──
  console.log('submit absent (honest failure):');
  field.textContent = 'Great insights, congrats!';
  submit.remove();
  doc.getElementById('reply-decoy').remove(); // would otherwise be the last-ditch pick
  let clicks4 = armClickRecorders();
  let r4 = await new Promise(res => eng.findAndClickSubmit(post, field, res));
  check('returns false honestly', r4 === false, 'r4=' + r4);
  check('toggle never clicked as submit', clicks4.indexOf('toggle') === -1, JSON.stringify(clicks4));

  console.log('\n== Results: ' + pass + ' passed, ' + fail + ' failed ==');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
