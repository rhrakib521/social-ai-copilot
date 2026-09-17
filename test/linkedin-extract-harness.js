// DOM test: loads the REAL extension/content.js in jsdom with a realistic
// LinkedIn feed fixture, then verifies exactly what extractContext() feeds
// to the AI when the popover is opened on a post's comment box.
// Run: node test/linkedin-extract-harness.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content.js'), 'utf8');
// Inject a test hook just before the IIFE closes (no production change).
const _iifeEnd = source.lastIndexOf('})();');
if (_iifeEnd === -1) { console.error('Could not find IIFE end in content.js'); process.exit(2); }
source = source.slice(0, _iifeEnd) +
  '\n;try { window.__saicTest = { extractContext: extractContext, cleanExtractPostText: cleanExtractPostText, getAuthorInfo: getAuthorInfo, AutomationEngine: AutomationEngine, platformConfig: platformConfig }; } catch (e) {}\n' +
  source.slice(_iifeEnd);

// ── Realistic LinkedIn feed fixture ──
// Two posts (the target + a neighbor), the target has loaded comments.
const FIXTURE = `
<div id="feed">
  <div class="scaffold-finite-scroll__item">
    <div class="feed-shared-update-v2" data-urn="urn:li:activity:7110000000000000001">
      <div class="update-components-wrapper">
        <div class="update-components-actor">
          <a class="update-components-actor__image" href="/in/target-author"><span></span></a>
          <div class="update-components-actor__title">
            <span dir="ltr"><span class="visually-hidden">Target Author</span><span>Target Author</span></span>
            <span class="update-components-actor__sub-description">3rd+</span>
          </div>
        </div>
        <div class="feed-shared-update-v2__description">
          <div class="update-components-text">
            <span class="break-words"><span><span dir="ltr">We just cut our AWS bill by 38% by moving our image pipeline to edge functions. The biggest surprise was how much egress cost dominated. Happy to share the migration checklist if anyone wants it.</span></span></span>
          </div>
        </div>
        <div class="text-view-model"><span class="break-words">DUPLICATE-TEXTVIEW that must never appear</span></div>
        <div class="feed-shared-update-v2__commentary">DUPLICATE-COMMENTARY that must never appear</div>
        <div class="social-details-social-counts">
          <span class="social-details-social-counts__reactions-count">247</span>
          <span class="social-details-social-counts__comments">31 comments</span>
        </div>
        <div class="comments-comments-list">
          <div class="comments-comments-list__comment-item">
            <div class="comments-comment-item__comment-text">Did edge functions add much latency to first paint?</div>
          </div>
          <div class="comments-comments-list__comment-item">
            <div class="comments-comment-item__comment-text">Could you DM the checklist?</div>
          </div>
        </div>
        <div class="comments-comment-box">
          <div class="comments-comment-texteditor">
            <div class="ql-editor" contenteditable="true" role="textbox" aria-label="Add a comment…"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="scaffold-finite-scroll__item">
    <div class="feed-shared-update-v2" data-urn="urn:li:activity:7110000000000000002">
      <div class="update-components-wrapper">
        <div class="update-components-actor">
          <div class="update-components-actor__title"><span dir="ltr">Other Author</span></div>
        </div>
        <div class="update-components-text">
          <span class="break-words"><span dir="ltr">OTHER-POST: Hiring three senior Rust engineers for our Berlin team, remote-friendly.</span></span>
        </div>
        <div class="social-details-social-counts"><span class="social-details-social-counts__reactions-count">89</span></div>
      </div>
    </div>
  </div>
</div>`;

// Same DOM but the comment box is inside a modal dialog wrapping the post
const MODAL_FIXTURE = `
<div id="page">
  <div class="feed-shared-update-v2" data-urn="urn:li:activity:7110000000000000999">
    <div class="update-components-text"><span class="break-words">BACKGROUND FEED POST about guitar lessons</span></div>
  </div>
</div>
<div role="dialog" aria-label="Post">
  <div class="feed-shared-update-v2" data-urn="urn:li:activity:7110000000000000001">
    <div class="update-components-text"><span class="break-words"><span dir="ltr">MODAL POST: Our Series A is official — 12M led by Northgate.</span></span></div>
    <div class="comments-comment-box">
      <div class="comments-comment-texteditor">
        <div class="ql-editor" contenteditable="true" role="textbox" aria-label="Add a comment…"></div>
      </div>
    </div>
  </div>
</div>`;

async function makeDom(fixture) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.linkedin.com/feed/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;

  // chrome mock
  const listeners = [];
  window.chrome = {
    runtime: {
      id: 'test-ext',
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: (msg, cb) => {
        if (msg && msg.type === 'getSettings') {
          setTimeout(() => cb && cb({ platforms: { linkedin: true }, platformSettings: { linkedin: {} }, contexts: [] }), 0);
        } else if (cb) {
          setTimeout(() => cb && cb({ text: 'ok' }), 0);
        }
      },
      lastError: null
    },
    storage: {
      local: {
        get: (keys, cb) => setTimeout(() => cb && cb({}), 0),
        set: (obj, cb) => cb && setTimeout(cb, 0),
        remove: (k, cb) => cb && setTimeout(cb, 0)
      },
      onChanged: { addListener: () => {} }
    }
  };

  window.document.body.innerHTML = fixture;
  // jsdom lacks innerText — alias to textContent like a real browser's behavior for our purposes
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get: function () { return this.textContent; }
  });

  const vm = require('vm');
  const ctx = dom.getInternalVMContext();
  vm.runInContext(source, ctx, { filename: 'content.js' });

  // jsdom starts at readyState 'loading', so content.js defers init() to
  // DOMContentLoaded — which fires on a later tick. Wait for it so
  // platformName/platformConfig are set before assertions run.
  await new Promise(r => setTimeout(r, 50));

  return { window, ctx };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

async function main() {
  console.log('== LinkedIn context extraction tests (real content.js in jsdom) ==\n');

  // ── Test 1: popover on the TARGET post's comment box ──
  console.log('[1] Comment box under the target post');
  {
    const { ctx } = await makeDom(FIXTURE);
    const field = ctx.document.querySelector('.comments-comment-texteditor .ql-editor');
    const result = ctx.__saicTest.extractContext(ctx.document.querySelector(".comments-comment-texteditor .ql-editor"));

    check('postText contains the actual post', /AWS bill by 38%/.test(result.postText), 'postText=' + JSON.stringify(result.postText).slice(0, 200));
    check('postText has NO duplicated post text', (result.postText.match(/AWS bill/g) || []).length === 1);
    check('postText excludes comment text', !/first paint/.test(result.postText) && !/DM the checklist/.test(result.postText));
    check('nearbyComments excludes the other full post', !(result.nearbyComments || []).some(c => /OTHER-POST/.test(c)),
      'nearby=' + JSON.stringify(result.nearbyComments));
    check('author resolved', /Target Author/.test(result.author || ''), 'author=' + JSON.stringify(result.author));
    check('engagement extracted', result.engagement && result.engagement.likes === 247, JSON.stringify(result.engagement));
  }

  // ── Test 2: reply-to-comment anchor gets comment + parent post ──
  console.log('[2] Field inside a comment item (reply to comment)');
  {
    const { ctx } = await makeDom(FIXTURE);
    const result = ctx.__saicTest.extractContext(ctx.document.querySelector(".comments-comments-list__comment-item .comments-comment-item__comment-text"));
    check('postText includes parent post', /AWS bill by 38%/.test(result.postText), 'postText=' + JSON.stringify(result.postText).slice(0, 200));
    check('postText includes the comment being replied to', /first paint/.test(result.postText));
    check('parent post appears once only', (result.postText.match(/AWS bill/g) || []).length === 1);
  }

  // ── Test 3: modal dialog scoping ──
  console.log('[3] Comment box inside a post modal (dialog)');
  {
    const { ctx } = await makeDom(MODAL_FIXTURE);
    const result = ctx.__saicTest.extractContext(ctx.document.querySelector("[role=\"dialog\"] .ql-editor"));
    check('postText is the MODAL post', /Series A/.test(result.postText), 'postText=' + JSON.stringify(result.postText).slice(0, 200));
    check('postText is NOT the background feed post', !/guitar lessons/.test(result.postText));
  }

  // ── Test 4: priority order — no .text-view-model duplicate pollution ──
  console.log('[4] Selector priority (no text-view-model/commentary dupes)');
  {
    const { ctx } = await makeDom(FIXTURE);
    const result = ctx.__saicTest.extractContext(ctx.document.querySelector(".comments-comment-texteditor .ql-editor"));
    check('DUPLICATE-TEXTVIEW absent', !/DUPLICATE-TEXTVIEW/.test(result.postText));
    check('DUPLICATE-COMMENTARY absent', !/DUPLICATE-COMMENTARY/.test(result.postText));
  }

  // ── Test 5: automation engine extractPostContext (auto-comment path) ──
  console.log('[5] AutomationEngine.extractPostContext on same fixture');
  {
    const { ctx } = await makeDom(FIXTURE);
    const result = ctx.__saicTest.AutomationEngine.extractPostContext(ctx.document.querySelector("[data-urn=\"urn:li:activity:7110000000000000001\"]"));
    check('auto path postText clean', /AWS bill by 38%/.test(result.postText) && (result.postText.match(/AWS bill/g) || []).length === 1,
      'postText=' + JSON.stringify(result.postText).slice(0, 200));
    check('auto path nearbyComments excludes other posts', !(result.nearbyComments || []).some(c => /OTHER-POST/.test(c)),
      'nearby=' + JSON.stringify(result.nearbyComments));
  }

  console.log('\n== Results: ' + pass + ' passed, ' + fail + ' failed ==');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
