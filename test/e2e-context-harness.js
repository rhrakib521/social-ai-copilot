// End-to-end context test: real DOM fixture in jsdom → real extension/content.js
// extractContext() → real extension/background.js 'generate' handler → the
// actual HTTP request body sent to the provider. Proves the post text the
// page shows is the text the AI receives — the full read→prompt→API chain.
// Run: node test/e2e-context-harness.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

// ── Load content.js with the test hook (same technique as linkedin-extract-harness) ──
let contentSrc = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content.js'), 'utf8');
const _iifeEnd = contentSrc.lastIndexOf('})();');
if (_iifeEnd === -1) { console.error('No IIFE end in content.js'); process.exit(2); }
contentSrc = contentSrc.slice(0, _iifeEnd) +
  '\n;try { window.__saicTest = { extractContext: extractContext, heuristicTextExtract: heuristicTextExtract, expandCollapsedPost: expandCollapsedPost, runFieldDiagnostics: runFieldDiagnostics }; } catch (e) {}\n' +
  contentSrc.slice(_iifeEnd);

async function makeContentDom(url, fixture) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url, runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  window.chrome = {
    runtime: {
      id: 'test-ext',
      onMessage: { addListener: () => {} },
      sendMessage: (msg, cb) => setTimeout(() => cb && cb({ platforms: {}, platformSettings: {}, contexts: [] }), 0),
      lastError: null
    },
    storage: {
      local: { get: (k, cb) => setTimeout(() => cb && cb({}), 0), set: (o, cb) => cb && setTimeout(cb, 0), remove: (k, cb) => cb && setTimeout(cb, 0) },
      onChanged: { addListener: () => {} }
    }
  };
  window.document.body.innerHTML = fixture;
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    configurable: true, get: function () { return this.textContent; }
  });
  vm.runInContext(contentSrc, dom.getInternalVMContext(), { filename: 'content.js' });
  await new Promise(r => setTimeout(r, 50)); // let DOMContentLoaded → init() run
  return dom.getInternalVMContext();
}

// ── Load background.js with a capturing fetch (same technique as provider-harness) ──
const bgSource = fs.readFileSync(path.join(__dirname, '..', 'extension', 'background.js'), 'utf8');
let capturedRequests = [];
function capturingFetch(url, init) {
  const body = init && init.body ? JSON.parse(init.body) : null;
  capturedRequests.push({ url, body });
  return Promise.resolve({
    ok: true, status: 200,
    text: () => Promise.resolve('{"choices":[{"message":{"content":"e2e ok"}}]}'),
    json: () => Promise.resolve({ choices: [{ message: { content: 'e2e ok' } }] })
  });
}
let storageData = {};
const bgListeners = [];
const bgSandbox = {
  console: { log: () => {}, error: () => {} },
  fetch: capturingFetch,
  chrome: {
    runtime: { onMessage: { addListener: fn => bgListeners.push(fn) }, lastError: null },
    commands: { onCommand: { addListener: () => {} } },
    storage: {
      local: {
        get: (keys, cb) => { const out = {}; (Array.isArray(keys) ? keys : [keys]).forEach(k => { if (storageData[k] !== undefined) out[k] = storageData[k]; }); setTimeout(() => cb(out), 0); },
        set: (obj, cb) => { Object.assign(storageData, obj); if (cb) setTimeout(cb, 0); }
      }
    },
    tabs: { update: (id, p, cb) => cb && cb() }
  },
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  TextEncoder, crypto: require('crypto').webcrypto,
  setTimeout, clearTimeout, AbortController
};
vm.createContext(bgSandbox);
vm.runInContext(bgSource, bgSandbox, { filename: 'background.js' });

function sendGenerate(data) {
  return new Promise(resolve => {
    bgListeners[bgListeners.length - 1]({ type: 'generate', data }, { tab: { id: 1 } }, resolve);
  });
}

// ═══════════════════════════ FIXTURES ═══════════════════════════

// Standard LinkedIn text post + decoy neighbor post (2026 markup)
const LI_STANDARD = `
<div class="scaffold-finite-scroll__item">
  <div class="feed-shared-update-v2" data-urn="urn:li:activity:71001">
    <div class="update-components-wrapper">
      <div class="update-components-actor">
        <div class="update-components-actor__title"><span dir="ltr">Target Author</span></div>
      </div>
      <div class="feed-shared-update-v2__description">
        <div class="update-components-text">
          <span class="break-words"><span dir="ltr">We just cut our AWS bill by 38% by moving our image pipeline to edge functions. Egress cost dominated more than anyone expected.</span></span>
        </div>
      </div>
      <div class="social-details-social-counts"><span class="social-details-social-counts__reactions-count">247</span></div>
      <div class="comments-comment-box">
        <div class="comments-comment-texteditor">
          <div class="ql-editor" contenteditable="true" role="textbox" aria-label="Add a comment…"></div>
        </div>
      </div>
    </div>
  </div>
</div>
<div class="scaffold-finite-scroll__item">
  <div class="feed-shared-update-v2" data-urn="urn:li:activity:71002">
    <div class="update-components-text"><span class="break-words"><span dir="ltr">OTHER-POST: Hiring three senior Rust engineers for our Berlin team.</span></span></div>
  </div>
</div>`;

// Repost: outer commentary + embedded mini-update (both must reach the AI)
const LI_REPOST = `
<div class="feed-shared-update-v2" data-urn="urn:li:activity:71003">
  <div class="update-components-text">
    <span class="break-words"><span dir="ltr">REPOST-COMMENTARY: Proud to share my friend's deep dive on serverless cost traps.</span></span>
  </div>
  <div class="feed-shared-update-v2__content">
    <div class="feed-shared-mini-update-v2">
      <div class="update-components-text">
        <span class="break-words"><span dir="ltr">INNER-POST: Serverless egress fees are the hidden killer — we audited 40 startups.</span></span>
      </div>
    </div>
  </div>
  <div class="comments-comment-box">
    <div class="comments-comment-texteditor">
      <div class="ql-editor" contenteditable="true" role="textbox"></div>
    </div>
  </div>
</div>`;

// Long post collapsed behind a "...more" toggle INSIDE the text container
const LI_TRUNCATED = `
<div class="feed-shared-update-v2" data-urn="urn:li:activity:71004">
  <div class="update-components-text">
    <span class="break-words"><span dir="ltr">TRUNCATED-POST: Our full SOC 2 audit timeline took nine months. Week one we froze deploys. Week two we inventoried every data store. Week three the auditors asked for evidence we did not have, and that is where the real work started.</span></span>
    <button class="see-more">…more</button>
  </div>
  <div class="comments-comment-box">
    <div class="comments-comment-texteditor">
      <div class="ql-editor" contenteditable="true" role="textbox"></div>
    </div>
  </div>
</div>`;

// Post opened in a modal dialog — background feed post must NOT win
const LI_MODAL = `
<div class="feed-shared-update-v2" data-urn="urn:li:activity:71099">
  <div class="update-components-text"><span class="break-words">BACKGROUND-FEED-POST about guitar lessons</span></div>
</div>
<div role="dialog" aria-label="Post">
  <div class="feed-shared-update-v2" data-urn="urn:li:activity:71005">
    <div class="update-components-text"><span class="break-words"><span dir="ltr">MODAL-POST: Our Series A is official — 12M led by Northgate.</span></span></div>
    <div class="comments-comment-box">
      <div class="comments-comment-texteditor">
        <div class="ql-editor" contenteditable="true" role="textbox"></div>
      </div>
    </div>
  </div>
</div>`;

// Facebook feed post (minified classes, data-attribute hooks)
const FB_POST = `
<div data-pagelet="FeedFeed_Story">
  <div role="article">
    <h4><a href="#"><span>FB Author</span></a></h4>
    <div data-ad-comet-preview="message"><span>FB-POST: Farm-to-table supply chains still run on fax machines and voicemail.</span></div>
    <div role="button" aria-label="Like">Like</div>
    <div>
      <div role="textbox" aria-label="Write a comment" contenteditable="true" data-contents="true"></div>
    </div>
  </div>
</div>
<div data-pagelet="FeedFeed_Story">
  <div role="article">
    <div data-ad-comet-preview="message"><span>FB-DECOY: Totally unrelated post about a marathon.</span></div>
  </div>
</div>`;

// X post with tweetText + inline reply field
const X_POST = `
<article data-testid="tweet" tabindex="-1">
  <div data-testid="User-Name"><a href="/shipper"><span>Shipper</span></a></div>
  <div data-testid="tweetText" lang="en">X-POST: Shipping v2 of our observability pipeline today. Query latency down 12x.</div>
  <div data-testid="reply">
    <div data-testid="tweetTextarea_0">
      <div contenteditable="true" role="textbox" class="public-DraftEditor-content" aria-label="Post your reply"></div>
    </div>
  </div>
</article>`;

// ═══════════════════════════ TESTS ═══════════════════════════

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

async function runThroughApi(platform, url, fixture, fieldSelector, pre) {
  const ctx = await makeContentDom(url, fixture);
  if (pre) pre(ctx);
  const field = ctx.document.querySelector(fieldSelector);
  if (!field) throw new Error('fixture field not found: ' + fieldSelector);
  const context = ctx.__saicTest.extractContext(field);

  storageData['socialAiCopilot_settings'] = { provider: 'gemini', apiKey: 'g-x', geminiModel: 'gemini-3.8-flash' };
  capturedRequests = [];
  const resp = await sendGenerate({ platform, task: 'quick_reply', tone: 'casual', context });
  if (resp && resp.error) throw new Error('generate error: ' + resp.error);
  const req = capturedRequests[capturedRequests.length - 1];
  return { context, request: req };
}

async function main() {
  console.log('== E2E context tests: page DOM → extractContext → buildPrompt → API request ==\n');

  console.log('[1] LinkedIn standard text post');
  {
    const { context, request } = await runThroughApi('linkedin', 'https://www.linkedin.com/feed/', LI_STANDARD, '.comments-comment-texteditor .ql-editor');
    const userMsg = request.body.messages[1].content;
    check('post text reaches the API user message', /AWS bill by 38%/.test(userMsg), userMsg.slice(0, 200));
    check('post appears exactly once (no duplication)', (userMsg.match(/AWS bill/g) || []).length === 1);
    check('neighbor post does NOT leak in', !/OTHER-POST/.test(userMsg));
    check('author included', /Target Author/.test(userMsg));
    check('sent to Gemini compat endpoint', /generativelanguage\.googleapis\.com\/v1beta\/openai/.test(request.url), request.url);
    check('model is gemini-3.8-flash', request.body.model === 'gemini-3.8-flash', request.body.model);
    check('thinking budget floor applied (>=1500)', (request.body.max_tokens || 0) >= 1500, String(request.body.max_tokens));
    check('engagement in message', /247/.test(userMsg));
  }

  console.log('[2] LinkedIn repost (commentary + embedded post)');
  {
    const { context, request } = await runThroughApi('linkedin', 'https://www.linkedin.com/feed/', LI_REPOST, '.comments-comment-texteditor .ql-editor');
    const userMsg = request.body.messages[1].content;
    check('outer commentary included', /REPOST-COMMENTARY/.test(userMsg), (context.postText || '').slice(0, 120));
    check('embedded inner post included', /INNER-POST/.test(userMsg));
  }

  console.log('[3] LinkedIn truncated post (see-more toggle)');
  {
    const { context, request } = await runThroughApi('linkedin', 'https://www.linkedin.com/feed/', LI_TRUNCATED, '.comments-comment-texteditor .ql-editor');
    const userMsg = request.body.messages[1].content;
    check('truncated post text included', /TRUNCATED-POST/.test(userMsg));
    check('"…more" button label NOT in text', !/…more/.test(userMsg) && !/\\.\\.\\.more/.test(userMsg));
  }

  console.log('[4] LinkedIn post modal (dialog scoping)');
  {
    const { request } = await runThroughApi('linkedin', 'https://www.linkedin.com/feed/', LI_MODAL, '[role="dialog"] .ql-editor');
    const userMsg = request.body.messages[1].content;
    check('modal post extracted', /MODAL-POST/.test(userMsg));
    check('background feed post NOT extracted', !/BACKGROUND-FEED-POST/.test(userMsg));
  }

  console.log('[5] Facebook feed post');
  {
    const { request } = await runThroughApi('facebook', 'https://www.facebook.com/', FB_POST, '[aria-label="Write a comment"]');
    const userMsg = request.body.messages[1].content;
    check('FB post text reaches the API', /FB-POST: Farm-to-table/.test(userMsg), userMsg.slice(0, 200));
    check('FB decoy post NOT in message', !/FB-DECOY/.test(userMsg));
    check('Like button label NOT in message', !/Like/.test(userMsg.replace(/Like/g, '')) || !/\bLike\b/.test(userMsg));
  }

  console.log('[6] X post with inline reply');
  {
    const { request } = await runThroughApi('x', 'https://x.com/shipper/status/123', X_POST, '[data-testid="tweetTextarea_0"] [contenteditable="true"]');
    const userMsg = request.body.messages[1].content;
    check('tweet text reaches the API', /X-POST: Shipping v2/.test(userMsg), userMsg.slice(0, 200));
  }

  console.log('[7] Heuristic fallback survives renamed classes');
  {
    // Same structure as LI_STANDARD but every known class renamed — only the
    // heuristic (largest text block) can find the post text.
    const RENAMED = `
<div class="zzz-card" data-urn="urn:li:activity:71006">
  <div class="zzz-head"><span dir="ltr">Renamed Author</span></div>
  <div class="zzz-body">
    <span dir="ltr">RENAMED-POST: We migrated 400 microservices to ARM Graviton and cut compute spend by 31 percent in one quarter.</span>
  </div>
  <div class="zzz-actions"><button>Like</button><button>Comment</button></div>
  <div class="zzz-composer">
    <div class="ql-editor" contenteditable="true" role="textbox"></div>
  </div>
</div>`;
    const ctx = await makeContentDom('https://www.linkedin.com/feed/', RENAMED);
    const result = ctx.__saicTest.extractContext(ctx.document.querySelector('.zzz-composer .ql-editor'));
    check('heuristic finds text when all classes renamed', /RENAMED-POST/.test(result.postText || ''), JSON.stringify((result.postText || '').slice(0, 120)));
  }

  console.log('[8] Composer in a side drawer (split view — post NOT above field, no dialog)');
  {
    // Real-browser geometry: jsdom rects are all-zero, so mock getBoundingClientRect
    // to read data-x/y/w/h attributes off the fixture elements.
    const DRAWER = `
<div id="split">
  <div class="feed-shared-update-v2" data-urn="urn:li:activity:71007" data-x="0" data-y="100" data-w="600" data-h="400">
    <div class="update-components-text"><span class="break-words"><span dir="ltr">DRAWER-POST: The post sits in the left pane of the split view, beside the composer.</span></span></div>
  </div>
  <div class="feed-shared-update-v2" data-urn="urn:li:activity:71008" data-x="0" data-y="2000" data-w="600" data-h="400">
    <div class="update-components-text"><span class="break-words">DECOY-BELOW: much further down the feed</span></div>
  </div>
  <aside class="comments-drawer" data-x="700" data-y="200" data-w="300" data-h="300">
    <div class="comments-comment-texteditor" data-x="710" data-y="210" data-w="280" data-h="40">
      <div class="ql-editor" contenteditable="true" role="textbox"></div>
    </div>
  </aside>
</div>`;
    const rectMock = function (ctx) {
      ctx.window.Element.prototype.getBoundingClientRect = function () {
        var x = parseFloat(this.getAttribute('data-x') || '');
        var y = parseFloat(this.getAttribute('data-y') || '');
        var w = parseFloat(this.getAttribute('data-w') || '');
        var h = parseFloat(this.getAttribute('data-h') || '');
        if (isNaN(x) || isNaN(y)) return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
        return { top: y, left: x, right: x + w, bottom: y + h, width: w, height: h };
      };
    };
    const { request } = await runThroughApi('linkedin', 'https://www.linkedin.com/feed/', DRAWER, 'aside .ql-editor', rectMock);
    const userMsg = request.body.messages[1].content;
    check('split-view: nearest post beside the composer wins', /DRAWER-POST/.test(userMsg), userMsg.slice(0, 200));
    check('split-view: distant decoy post excluded', !/DECOY-BELOW/.test(userMsg));
  }

  console.log('[9] Composer inside a Web Component shadow root');
  {
    const ctx = await makeContentDom('https://www.linkedin.com/feed/', '<div id="app-host"></div>');
    const host = ctx.document.getElementById('app-host');
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<div class="feed-shared-update-v2" data-urn="urn:li:activity:71009">' +
      '<div class="update-components-text"><span class="break-words"><span dir="ltr">SHADOW-POST: rendered inside a web component shadow root.</span></span></div>' +
      '<li-composer></li-composer>' +
      '</div>';
    // The editable field sits in a SECOND nested shadow root, so the ancestor
    // walk must cross two shadow boundaries to reach the post.
    const composerHost = sr.querySelector('li-composer');
    const sr2 = composerHost.attachShadow({ mode: 'open' });
    sr2.innerHTML = '<div class="ql-editor" contenteditable="true" role="textbox"></div>';
    const field = sr2.querySelector('.ql-editor');
    const result = ctx.__saicTest.extractContext(field);
    check('shadow root: post found across shadow boundaries', /SHADOW-POST/.test(result.postText || ''), JSON.stringify((result.postText || '').slice(0, 120)));
  }

  console.log('[10] Deeply nested composer (24 wrapper levels)');
  {
    const nest = '<div class="feed-shared-update-v2" data-urn="urn:li:activity:71010">' +
      '<div class="update-components-text"><span class="break-words"><span dir="ltr">DEEP-POST: the comment editor is buried 24 wrapper divs deep.</span></span></div>' +
      '<div class="comments-comment-box">' + '<div class="wrap">'.repeat(24) +
      '<div class="ql-editor" contenteditable="true" role="textbox"></div>' +
      '</div>'.repeat(24) + '</div></div>';
    const { request } = await runThroughApi('linkedin', 'https://www.linkedin.com/feed/', nest, '.ql-editor');
    const userMsg = request.body.messages[1].content;
    check('deep nesting: post found beyond depth 20', /DEEP-POST/.test(userMsg), userMsg.slice(0, 200));
  }

  console.log('[11] Diagnostics report content');
  {
    const ctx = await makeContentDom('https://www.linkedin.com/feed/', LI_STANDARD);
    const field = ctx.document.querySelector('.comments-comment-texteditor .ql-editor');
    const report = ctx.__saicTest.runFieldDiagnostics(field);
    check('report has ancestor chain', /ANCESTOR CHAIN/.test(report) && /feed-shared-update-v2/.test(report));
    check('report has selector census', /POST SELECTOR CENSUS/.test(report) && /\.feed-shared-update-v2 → \d+ match/.test(report));
    check('report has extraction result', /EXTRACTION RESULT/.test(report) && /AWS bill/.test(report));
  }

  console.log('\n== Results: ' + pass + ' passed, ' + fail + ' failed ==');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
