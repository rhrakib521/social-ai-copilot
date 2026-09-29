// Focused test: LinkedIn 2026 candidate filtering and post association.
//   1. findCandidatePosts returns only real posts (share box / sort toggle /
//      "Add to your feed" modules and nested listitems are rejected)
//   2. dismissOpenEditors blurs a stale TipTap composer in a processed post
//   3. fieldBelongsToPost associates a composer with its post via listitem
// Run: node test/linkedin-candidates-harness.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

let contentSrc = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content.js'), 'utf8');
const _iifeEnd = contentSrc.lastIndexOf('})();');
contentSrc = contentSrc.slice(0, _iifeEnd) +
  '\n;try { window.__saicTest = { AutomationEngine: AutomationEngine, fieldBelongsToPost: fieldBelongsToPost }; } catch (e) {}\n' +
  contentSrc.slice(_iifeEnd);

// 2026 SDUI fixture modeled on live captures: real posts are listitems with a
// comment button + expandable-text-box; modules match postSelector but have
// neither. Classes are hashed gibberish exactly like the real feed.
const FIXTURE = `
<main id="workspace" style="overflow-y: scroll">
  <div role="list" data-testid="mainFeed" data-component-type="LazyColumn">
    <div role="listitem" class="m6fmvy" id="mod-sharebox"><div id="shareboxProfilePictureComponent"></div><a href="/in/me/"><span>Me</span></a></div>
    <div role="listitem" class="m6fa49" id="mod-sorttoggle"><div role="button" tabindex="0" data-view-name="feed-nav-feed-sort-toggle" aria-expanded="false">Sort by</div></div>
    <div role="listitem" class="e5d9f935" id="post-1">
      <div data-view-name="feed-full-update">
        <a href="/in/author1/"><span dir="ltr">Author One</span></a>
        <div data-testid="expandable-text-box">Excited to share our Q3 numbers grew 40% quarter over quarter with zero paid spend.</div>
        <button aria-label="Comment">14</button>
        <button aria-label="Repost">​</button>
      </div>
    </div>
    <div role="listitem" class="e5d9f935" id="post-2">
      <div data-view-name="feed-full-update">
        <a href="/company/acme/"><span dir="ltr">Acme</span></a>
        <div data-testid="expandable-text-box">We are hiring founding engineers to build the next generation of developer tooling.</div>
        <button aria-label="Comment">7</button>
        <div role="listitem" id="post-2-nested-comment">
          <div data-testid="expandable-text-box">Nested comment text that is long enough to look like a post body for filtering purposes yes.</div>
        </div>
      </div>
    </div>
  </div>
</main>`;

const dom = new JSDOM(FIXTURE, {
  url: 'https://www.linkedin.com/feed/', runScripts: 'outside-only', pretendToBeVisual: true
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

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

setTimeout(async function () {
  const T = window.__saicTest;
  const doc = window.document;
  const eng = T.AutomationEngine;
  eng.state = 'running';

  // ── 1. Candidate filter ──
  console.log('candidate filtering:');
  const candidates = eng.findCandidatePosts();
  const ids = candidates.map(c => c.id || '(no-id)');
  check('only real posts are candidates', candidates.length === 2, 'got: ' + ids.join(','));
  check('post-1 included', ids.indexOf('post-1') !== -1);
  check('post-2 included', ids.indexOf('post-2') !== -1);
  check('share box module rejected', ids.indexOf('mod-sharebox') === -1);
  check('sort toggle module rejected', ids.indexOf('mod-sorttoggle') === -1);
  check('nested comment listitem rejected', ids.indexOf('post-2-nested-comment') === -1);

  // ── 2. dismissOpenEditors with a stale TipTap composer ──
  console.log('dismissOpenEditors:');
  const post1 = doc.getElementById('post-1');
  const staleEditor = doc.createElement('div');
  staleEditor.className = 'tiptap ProseMirror m6fncz';
  staleEditor.setAttribute('contenteditable', 'true');
  staleEditor.textContent = 'stale unsubmitted text';
  post1.querySelector('[data-view-name="feed-full-update"]').appendChild(staleEditor);
  eng.processedPosts.add(eng.getPostFingerprint(post1)); // post-1 already processed
  staleEditor.focus();
  check('stale editor focused before dismiss', doc.activeElement === staleEditor);
  eng.dismissOpenEditors();
  check('stale TipTap composer blurred', doc.activeElement !== staleEditor, 'still focused');

  // A composer in an UNprocessed post must NOT be blurred
  const post2 = doc.getElementById('post-2');
  const freshEditor = doc.createElement('div');
  freshEditor.className = 'tiptap ProseMirror';
  freshEditor.setAttribute('contenteditable', 'true');
  freshEditor.textContent = 'fresh draft';
  post2.appendChild(freshEditor);
  freshEditor.focus();
  eng.dismissOpenEditors();
  check('fresh composer left focused', doc.activeElement === freshEditor);

  // ── 3. fieldBelongsToPost ──
  console.log('fieldBelongsToPost:');
  check('composer inside post-1 belongs to post-1', T.fieldBelongsToPost(staleEditor, post1) === true);
  check('composer inside post-1 does NOT belong to post-2', T.fieldBelongsToPost(staleEditor, post2) === false);
  const modalEditor = doc.createElement('div');
  modalEditor.className = 'tiptap ProseMirror';
  modalEditor.setAttribute('contenteditable', 'true');
  const modal = doc.createElement('div');
  modal.setAttribute('role', 'dialog');
  modal.appendChild(modalEditor);
  doc.body.appendChild(modal);
  check('modal composer accepted (no post ancestor)', T.fieldBelongsToPost(modalEditor, post1) === true);

  console.log('\n== Results: ' + pass + ' passed, ' + fail + ' failed ==');
  process.exit(fail > 0 ? 1 : 0);
}, 300);
