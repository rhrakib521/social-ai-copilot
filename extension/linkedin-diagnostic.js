// === LinkedIn DOM Diagnostic Script (2026 SDUI feed) ===
// Paste this into the browser console on linkedin.com/feed to see
// what DOM structure LinkedIn is currently using for posts.
// Run: open DevTools (F12) → Console tab → paste this → press Enter
//
// 2026 reality (verified live Sept 2026): the feed is an inner overflow
// container (<main id="workspace">), posts are [role="listitem"]s inside
// [data-testid="mainFeed"] mixed with non-post modules, the inline comment
// composer is a TipTap editor, and the submit is a text-only "Comment"
// button with an empty aria-label that appears only after typing.

(function() {
  console.log('=== LinkedIn DOM Diagnostic (2026 hooks first) ===');

  // 0. Which element actually scrolls the feed?
  console.log('\n--- Scroll Root ---');
  var scrollers = [];
  var walkEl = document.querySelector('[data-testid="mainFeed"]') || document.querySelector('main, [role="main"]');
  for (var w = walkEl; w && w !== document.documentElement; w = w.parentElement) {
    var st = getComputedStyle(w);
    if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && w.scrollHeight > w.clientHeight + 8) {
      scrollers.push(w);
    }
  }
  var docScrolls = document.scrollingElement || document.documentElement;
  if (docScrolls.scrollHeight > docScrolls.clientHeight + 8) scrollers.push(docScrolls);
  scrollers.forEach(function(s, i) {
    console.log((i === 0 ? '✅ innermost: ' : '   ') + '<' + s.tagName.toLowerCase() + (s.id ? '#' + s.id : '') +
      '> overflow-y=' + getComputedStyle(s).overflowY + ' scrollHeight=' + s.scrollHeight + ' clientHeight=' + s.clientHeight);
  });
  if (!scrollers.length) console.log('❌ nothing scrolls (page shorter than viewport?)');

  // 1. Find all post containers (2026 SDUI first, legacy fallbacks after)
  var containerSelectors = [
    '[data-testid="mainFeed"] [role="listitem"]',
    '.feed-shared-update-v2',
    '.feed-shared-celebration-v2',
    '.occludable-update',
    '[data-urn*="urn:li:activity"]',
    '[data-urn*="urn:li:ugcPost"]',
    '[data-urn*="urn:li:share"]',
    '[data-id*="urn:li:activity"]'
  ];

  console.log('\n--- Post Container Selectors ---');
  var items = document.querySelectorAll(containerSelectors[0]);
  console.log(containerSelectors[0] + ': ' + items.length + ' listitems (posts + feed modules)');

  // Classify the listitems: a real post has a comment button or a post body
  var firstPost = null, modules = [], posts = [];
  Array.prototype.forEach.call(items, function(el) {
    var isModule = !!el.querySelector('[data-view-name="feed-nav-feed-sort-toggle"]') ||
      !!el.querySelector('#shareboxProfilePictureComponent') || el.getAttribute('data-view-name') === 'feed-nav-feed-sort-toggle';
    var hasCommentBtn = !!el.querySelector('button[aria-label="Comment"], button[aria-label*="Comment"]');
    var ext = el.querySelector('[data-testid="expandable-text-box"]');
    var hasBody = !!(ext && (ext.textContent || '').trim().length > 40);
    if (isModule || (!hasCommentBtn && !hasBody)) {
      modules.push(el.getAttribute('data-view-name') || el.className || '(anonymous module)');
    } else {
      posts.push(el);
      if (!firstPost) firstPost = el;
    }
  });
  console.log('✅ real posts: ' + posts.length + ' | feed modules (share box / sort toggle / promos): ' + modules.length);
  if (modules.length) console.log('   module markers: ' + modules.slice(0, 5).join(' | '));

  containerSelectors.slice(1).forEach(function(sel) {
    var els = document.querySelectorAll(sel);
    if (els.length > 0) console.log('legacy ' + sel + ': ' + els.length + ' matches');
    if (!firstPost && els.length > 0) firstPost = els[0];
  });

  if (!firstPost) {
    console.log('\n❌ No post container found! LinkedIn may have completely restructured the feed.');
    console.log('Dumping top-level feed children:');
    var main = document.querySelector('#workspace, .scaffold-finite-scroll, [role="main"], main');
    if (main) {
      Array.from(main.children).slice(0, 10).forEach(function(child, i) {
        console.log('  [' + i + '] <' + child.tagName + '> class="' + (child.className || '').substring(0, 100) + '"');
        Array.from(child.children).slice(0, 5).forEach(function(gc, j) {
          console.log('    [' + j + '] <' + gc.tagName + '> class="' + (gc.className || '').substring(0, 100) + '"');
        });
      });
    }
    return;
  }

  console.log('\n✅ First post: <' + firstPost.tagName.toLowerCase() + '> class="' + (firstPost.className || '').substring(0, 120) + '"');
  console.log('  data-urn: ' + (firstPost.getAttribute('data-urn') || 'none (2026 posts have none)'));

  // 2. Check content selectors (2026 first)
  var contentSelectors = [
    '[data-testid="expandable-text-box"]',
    '.update-components-text .break-words',
    '.update-components-text',
    '.attributed-text-segment-list__content',
    '.text-view-model',
    '.text-view-model .break-words',
    '[data-test-id="share-text"]',
    '.feed-shared-update-v2__commentary'
  ];

  console.log('\n--- Content Text Selectors ---');
  var foundContent = false;
  contentSelectors.forEach(function(sel) {
    var els = firstPost.querySelectorAll(sel);
    var marker = els.length > 0 ? '✅' : '  ';
    console.log(marker + ' ' + sel + ': ' + els.length + ' matches');
    if (els.length > 0 && !foundContent) {
      foundContent = true;
      console.log('    Text preview: "' + (els[0].innerText || '').substring(0, 150) + '..."');
    }
  });

  // 3. Check author selectors (2026: plain entity links)
  var authorSelectors = [
    'a[href^="/in/"] span[dir="ltr"]',
    'a[href*="/company/"] span[dir="ltr"]',
    'a[href^="/in/"], a[href*="/company/"]',
    '.update-components-actor__title span[dir="ltr"]',
    '.update-components-actor span[dir="ltr"]',
    '[data-control-name="actor"] span[dir="ltr"]'
  ];

  console.log('\n--- Author Selectors ---');
  var foundAuthor = false;
  authorSelectors.forEach(function(sel) {
    var els = firstPost.querySelectorAll(sel);
    var marker = els.length > 0 && !foundAuthor ? '✅' : '  ';
    console.log(marker + ' ' + sel + ': ' + els.length + ' matches');
    if (els.length > 0 && !foundAuthor) {
      foundAuthor = true;
      console.log('    Author: "' + (els[0].innerText || '').substring(0, 80) + '"');
    }
  });

  // 4. Engagement + comment button
  console.log('\n--- Engagement / Composer ---');
  var cbtn = firstPost.querySelector('button[aria-label="Comment"], button[aria-label*="Comment"]');
  console.log((cbtn ? '✅' : '  ') + 'comment toggle button[aria-label="Comment"]: ' + (cbtn ? 'text="' + (cbtn.textContent || '').trim() + '" (count)' : 'not found'));
  var engSelectors = {
    reactions: '.social-details-social-counts__reactions-count, button[aria-label*="react" i] span, [data-test-id="social-counts-reactions"]',
    comments: '.social-details-social-counts__comments, [data-test-id="social-counts-comments"]'
  };
  Object.keys(engSelectors).forEach(function(key) {
    var els = firstPost.querySelectorAll(engSelectors[key]);
    console.log('  ' + key + ': ' + els.length + ' matches (legacy selectors)');
  });

  console.log('\nℹ️ The inline composer (.tiptap.ProseMirror) only exists after clicking the comment toggle; the submit is a text-only "Comment" button with an empty aria-label that appears after typing.');
  console.log('\n=== End Diagnostic ===');
})();
