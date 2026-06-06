// === LinkedIn DOM Diagnostic Script ===
// Paste this into the browser console on linkedin.com/feed to see
// what DOM structure LinkedIn is currently using for posts.
// Run: open DevTools (F12) → Console tab → paste this → press Enter

(function() {
  console.log('=== LinkedIn DOM Diagnostic ===');

  // 1. Find all post containers
  var containerSelectors = [
    '.feed-shared-update-v2',
    '.feed-shared-celebration-v2',
    '.occludable-update',
    '[data-urn*="urn:li:activity"]',
    '[data-urn*="urn:li:ugcPost"]',
    '[data-urn*="urn:li:share"]',
    '.feed-shared-update',
    '[data-id*="urn:li:activity"]'
  ];

  console.log('\n--- Post Container Selectors ---');
  var firstPost = null;
  containerSelectors.forEach(function(sel) {
    var els = document.querySelectorAll(sel);
    console.log(sel + ': ' + els.length + ' matches');
    if (!firstPost && els.length > 0) firstPost = els[0];
  });

  if (!firstPost) {
    console.log('\n❌ No post container found! LinkedIn may have completely restructured the feed.');
    console.log('Dumping top-level feed children:');
    var main = document.querySelector('.scaffold-finite-scroll, [role="main"], main');
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

  console.log('\n✅ Found post container: <' + firstPost.tagName + '> class="' + (firstPost.className || '').substring(0, 200) + '"');
  console.log('  data-urn: ' + (firstPost.getAttribute('data-urn') || 'none'));

  // 2. Check content selectors
  var contentSelectors = [
    '.update-components-text .break-words',
    '.update-components-text',
    '.attributed-text-segment-list__content',
    '.feed-shared-inline-show-more-text',
    '.feed-shared-update-v2__description .break-words',
    '.text-view-model',
    '.text-view-model .break-words',
    '[data-test-id="share-text"]',
    '.feed-shared-text',
    '.feed-shared-update-v2__commentary',
    '.comments-comment-item__comment-text'
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

  if (!foundContent) {
    console.log('\n❌ No content selector matched! Dumping post children:');
    Array.from(firstPost.children).forEach(function(child, i) {
      var txt = (child.innerText || '').trim().substring(0, 80);
      console.log('  [' + i + '] <' + child.tagName + '> class="' + (child.className || '').substring(0, 120) + '"');
      console.log('      text: "' + txt + '..."');
      // Go one level deeper
      Array.from(child.children).slice(0, 5).forEach(function(gc, j) {
        var gtxt = (gc.innerText || '').trim().substring(0, 60);
        console.log('    [' + j + '] <' + gc.tagName + '> class="' + (gc.className || '').substring(0, 80) + '"');
        console.log('        text: "' + gtxt + '"');
      });
    });
  }

  // 3. Check author selectors
  var authorSelectors = [
    '.update-components-actor__title span[dir="ltr"]',
    '.update-components-actor__name',
    '.feed-shared-actor__title',
    '.feed-shared-actor__name',
    '.update-components-actor span[dir="ltr"]',
    '[data-control-name="actor"] span[dir="ltr"]'
  ];

  console.log('\n--- Author Selectors ---');
  authorSelectors.forEach(function(sel) {
    var els = firstPost.querySelectorAll(sel);
    var marker = els.length > 0 ? '✅' : '  ';
    console.log(marker + ' ' + sel + ': ' + els.length + ' matches');
    if (els.length > 0) console.log('    Author: "' + (els[0].innerText || '').substring(0, 80) + '"');
  });

  // 4. Check engagement selectors
  var engSelectors = {
    reactions: '.social-details-social-counts__reactions-count, button[aria-label*="react" i] span, [data-test-id="social-counts-reactions"]',
    comments: '.social-details-social-counts__comments, button[aria-label*="comment" i] span, [data-test-id="social-counts-comments"]'
  };

  console.log('\n--- Engagement Selectors ---');
  Object.keys(engSelectors).forEach(function(key) {
    var els = firstPost.querySelectorAll(engSelectors[key]);
    console.log(key + ': ' + els.length + ' matches (selector: ' + engSelectors[key].substring(0, 60) + '...)');
  });

  console.log('\n=== End Diagnostic ===');
})();
