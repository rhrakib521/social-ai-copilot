// content.js
// Main content script entry point for Social AI Copilot.
// Detects platform, listens for double-click on editable fields,
// creates draggable popover with hover close button, and communicates with background.js.

(function () {
  'use strict';

  // ── State ──
  var platformConfig = null;
  var platformName = null;
  var activeField = null;
  var currentPopoverEl = null;
  var currentTriggerWrapper = null;
  var savedSettings = null;
  var lastGeneratedText = '';
  var lastGeneratedAction = '';
  var lastGeneratedTone = '';

  // ── Text insertion utility ──
  function insertTextAtCursor(field, text) {
    field.focus();

    if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
      var start = field.selectionStart;
      var end = field.selectionEnd;
      var value = field.value;
      field.value = value.substring(0, start) + text + value.substring(end);
      field.selectionStart = field.selectionEnd = start + text.length;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // contenteditable
    var selection = window.getSelection();
    if (!selection.rangeCount) {
      var tn = document.createTextNode(text);
      field.appendChild(tn);
      var r = document.createRange();
      r.setStartAfter(tn);
      r.collapse(true);
      selection.removeAllRanges();
      selection.addRange(r);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    var range = selection.getRangeAt(0);
    range.deleteContents();
    var ok = document.execCommand('insertText', false, text);
    if (!ok) {
      var tn2 = document.createTextNode(text);
      range.insertNode(tn2);
      range.setStartAfter(tn2);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  window.__saic_insertTextAtCursor = insertTextAtCursor;

  // ── Utility functions for automation ──

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function jitter(baseMs, pct) {
    pct = pct || 0.2;
    return Math.round(baseMs * (1 - pct + Math.random() * pct * 2));
  }

  function parseCount(text) {
    if (!text) return 0;
    text = (text + '').replace(/,/g, '').replace(/\s+/g, '').trim();
    var m = text.match(/([\d.]+)\s*(K|M|B)?/i);
    if (!m) return 0;
    var num = parseFloat(m[1]);
    if (isNaN(num)) return 0;
    var suffix = (m[2] || '').toUpperCase();
    if (suffix === 'K') return Math.round(num * 1000);
    if (suffix === 'M') return Math.round(num * 1000000);
    if (suffix === 'B') return Math.round(num * 1000000000);
    return Math.round(num);
  }

  function extractCountFromEl(el) {
    if (!el) return 0;
    var label = el.getAttribute('aria-label') || '';
    var m = label.match(/([\d,.]+\s*[KMB]?)\s*(reaction|like|comment|repost|retweet|share|upvote|view)/i);
    if (m) return parseCount(m[1]);
    return parseCount(el.innerText || el.textContent || '');
  }

  function getPostLink(postEl, platform) {
    var href = '';
    if (platform === 'linkedin') {
      // Try multiple selectors for LinkedIn post links
      var link = postEl.querySelector('a[href*="/posts/"], a[href*="/feed/update/"], a[href*="/activity/"], a[href*="urn:li:activity"]');
      if (link) href = link.getAttribute('href') || '';
      if (!href) {
        var timeEl = postEl.querySelector('time');
        if (timeEl) {
          // Time element may be wrapped in an anchor
          var timeLink = timeEl.closest('a');
          if (timeLink) href = timeLink.getAttribute('href') || '';
          // Or the parent of time may be an anchor
          if (!href && timeEl.parentElement && timeEl.parentElement.tagName === 'A') {
            href = timeEl.parentElement.getAttribute('href') || '';
          }
        }
      }
      // Try data attributes on the post element itself
      if (!href) {
        var activityUrn = postEl.getAttribute('data-urn') || postEl.getAttribute('data-activity-urn') || '';
        if (activityUrn) href = '/feed/update/' + activityUrn;
      }
    } else if (platform === 'facebook') {
      var link2 = postEl.querySelector('a[href*="/posts/"], a[href*="/permalink"], a[href*="story_fbid"], a[href*="/videos/"]');
      if (link2) href = link2.getAttribute('href') || '';
      if (!href) {
        // Try timestamp link
        var timestamp = postEl.querySelector('a[href*="story_fbid"], a[href*="/posts/"]');
        if (timestamp) href = timestamp.getAttribute('href') || '';
      }
      if (!href) {
        // Try the abbr time element's parent anchor
        var abbr = postEl.querySelector('abbr, time');
        if (abbr) {
          var abbrLink = abbr.closest('a');
          if (abbrLink) href = abbrLink.getAttribute('href') || '';
        }
      }
    } else if (platform === 'x') {
      // X tweet links — look for /status/ pattern
      var link3 = postEl.querySelector('a[href*="/status/"]');
      if (link3) href = link3.getAttribute('href') || '';
      // If inside a tweet, try the time link which always points to the tweet
      if (!href) {
        var xTime = postEl.querySelector('time');
        if (xTime) {
          var xTimeLink = xTime.closest('a');
          if (xTimeLink) href = xTimeLink.getAttribute('href') || '';
        }
      }
    } else if (platform === 'reddit') {
      var rdTag = postEl.tagName ? postEl.tagName.toLowerCase() : '';
      if (rdTag === 'shreddit-post') {
        var thingid = postEl.getAttribute('thingid');
        var subAttr2 = postEl.getAttribute('subreddit');
        if (thingid && thingid.indexOf('t3_') === 0 && subAttr2) {
          var postId2 = thingid.replace('t3_', '');
          href = 'https://www.reddit.com/r/' + subAttr2 + '/comments/' + postId2;
        }
      }
      if (!href) {
        var link4 = postEl.querySelector('a[href*="/comments/"], a.comments, a[data-testid="post-comment-link"], a.title, a[data-click-id="comments"]');
        if (link4) href = link4.getAttribute('href') || '';
      }
      if (!href) {
        // Try the post title link
        var titleLink = postEl.querySelector('a.title, a[data-click-id="body"]');
        if (titleLink) href = titleLink.getAttribute('href') || '';
      }
      if (href && href.charAt(0) === '/') href = 'https://www.reddit.com' + href;
    }
    if (href && href.charAt(0) === '/') href = window.location.origin + href;
    return href || window.location.href;
  }

  function getAuthorInfo(postEl, platform) {
    var info = { name: '', handle: '', profileUrl: '' };
    if (!postEl || !platform) return info;
    if (platform === 'linkedin') {
      var authorEl = postEl.querySelector('.update-components-actor__title span[dir="ltr"], .update-components-actor__name, span[class*="actor__title"]');
      if (authorEl) info.name = (authorEl.innerText || authorEl.textContent || '').trim();
      var profileEl = postEl.querySelector('.update-components-actor__image a, .update-components-actor__title a, a[class*="actor"][href*="/in/"]');
      if (profileEl) info.profileUrl = profileEl.getAttribute('href') || '';
      if (info.profileUrl && info.profileUrl.charAt(0) === '/') info.profileUrl = window.location.origin + info.profileUrl;
    } else if (platform === 'facebook') {
      var fbAuthor = postEl.querySelector('a[role="link"] span a span, h4 a span, strong span a, a[aria-label][href]');
      if (fbAuthor) info.name = (fbAuthor.innerText || fbAuthor.textContent || '').trim();
      var fbProfile = postEl.querySelector('h4 a, strong span a, a[href*="/profile.php"], a[href*="facebook.com/"][aria-label]');
      if (fbProfile) info.profileUrl = fbProfile.getAttribute('href') || '';
    } else if (platform === 'x') {
      var xHandle = postEl.querySelector('[data-testid="User-Name"] a');
      if (xHandle) {
        info.handle = (xHandle.getAttribute('href') || '').replace(/^\//, '');
        info.profileUrl = window.location.origin + '/' + info.handle;
      }
      var xName = postEl.querySelector('[data-testid="User-Name"] a span span, [data-testid="name"]');
      if (xName) info.name = (xName.innerText || xName.textContent || '').trim();
    } else if (platform === 'reddit') {
      var rdTag2 = postEl.tagName ? postEl.tagName.toLowerCase() : '';
      if (rdTag2 === 'shreddit-post') {
        var authorAttr = postEl.getAttribute('author');
        if (authorAttr) {
          info.name = authorAttr;
          info.handle = authorAttr;
          info.profileUrl = 'https://www.reddit.com/user/' + authorAttr;
        }
      }
      if (!info.name) {
        var rdAuthor = postEl.querySelector('.author, a[data-testid="post_author_link"], [data-testid="comment_author_link"]');
        if (rdAuthor) {
          info.name = (rdAuthor.innerText || rdAuthor.textContent || '').trim().replace(/^u\//, '');
          info.handle = info.name;
          info.profileUrl = 'https://www.reddit.com/user/' + info.handle;
        }
      }
    }
    return info;
  }

  function humanMouseMove(targetEl, callback) {
    var rect = targetEl.getBoundingClientRect();
    var destX = rect.left + rect.width * (0.3 + Math.random() * 0.4);
    var destY = rect.top + rect.height * (0.3 + Math.random() * 0.4);
    var startX = window.mouseX || randomBetween(100, window.innerWidth - 100);
    var startY = window.mouseY || randomBetween(100, window.innerHeight - 100);

    window.mouseX = destX;
    window.mouseY = destY;

    var numPoints = 3 + Math.floor(Math.random() * 3);
    var points = [{ x: startX, y: startY }];

    for (var i = 1; i <= numPoints; i++) {
      var t = i / (numPoints + 1);
      points.push({
        x: startX + (destX - startX) * t + randomBetween(-80, 80),
        y: startY + (destY - startY) * t + randomBetween(-60, 60)
      });
    }
    points.push({ x: destX, y: destY });

    var totalDuration = randomBetween(400, 1200);
    var startTime = performance.now();
    var pauseIndex = 1 + Math.floor(Math.random() * (points.length - 2));
    var paused = false;
    var pauseDuration = randomBetween(50, 150);

    function dispatchMouse(x, y) {
      var evt = new MouseEvent('mousemove', {
        clientX: x, clientY: y, bubbles: true, cancelable: true
      });
      document.dispatchEvent(evt);
    }

    function animate() {
      var now = performance.now();
      var elapsed = now - startTime;
      var progress = Math.min(elapsed / totalDuration, 1);

      var eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      var totalSegments = points.length - 1;
      var segFloat = eased * totalSegments;
      var segIndex = Math.min(Math.floor(segFloat), totalSegments - 1);
      var segProgress = segFloat - segIndex;

      var p0 = points[segIndex];
      var p1 = points[segIndex + 1];
      var x = p0.x + (p1.x - p0.x) * segProgress;
      var y = p0.y + (p1.y - p0.y) * segProgress;

      dispatchMouse(x, y);

      if (progress >= 1) {
        dispatchMouse(destX, destY);
        if (callback) callback();
        return;
      }

      if (!paused && segIndex >= pauseIndex && segProgress > 0.5) {
        paused = true;
        bgTimeout(animate, pauseDuration);
        return;
      }

      bgTimeout(animate, 16);
    }

    animate();
  }

  // ── Platform detection ──
  function detectPlatform(url) {
    if (!url) return null;
    var hostname = '';
    try { hostname = new URL(url).hostname; } catch (e) { return null; }
    if (hostname.indexOf('linkedin.com') !== -1) return 'linkedin';
    if (hostname.indexOf('facebook.com') !== -1) return 'facebook';
    if (hostname.indexOf('x.com') !== -1 || hostname.indexOf('twitter.com') !== -1) return 'x';
    if (hostname.indexOf('reddit.com') !== -1) return 'reddit';
    return null;
  }

  // ── Platform configs (inlined — content scripts cannot use ES module imports) ──
  var PLATFORMS = {
    linkedin: {
      editableFields: [
        '.ql-editor[contenteditable="true"]',
        '.msg-form__contenteditable[contenteditable="true"]',
        '.comments-comment-texteditor [contenteditable="true"]',
        '.comments-comment-box [contenteditable="true"]',
        '[role="textbox"][contenteditable="true"]',
        '[data-placeholder*="post"]',
        '[aria-label*="Post"]',
        '[aria-label*="comment"]',
        '[aria-label*="message"]',
        '.editor-content [contenteditable="true"]'
      ],
      postContainers: [
        '.feed-shared-update-v2',
        '.comments-comments-list__comment-item',
        '.msg-s-message-listevent'
      ],
      authorSelector: '.update-components-actor__title span[dir="ltr"], .comments-post-meta__actor span[dir="ltr"]',
      personality: 'You are writing for LinkedIn. The tone should be professional and thought-leadership oriented. Use industry-relevant language. Keep content polished and suitable for a business network.',
      postSelector: '.feed-shared-update-v2, .feed-shared-celebration-v2',
      commentButtonSelector: 'button[aria-label*="Comment"], button[aria-label*="comment"]',
      replyFieldSelector: '.ql-editor[contenteditable="true"]',
      submitButtonSelector: 'button[type="submit"], button.comments-comment-box__submit-button',
      reactionCountSelector: '.social-details-social-counts__reactions-count, button[aria-label*="react" i] span, span.social-details-social-counts__reactions-count',
      commentCountSelector: '.social-details-social-counts__comments, button[aria-label*="comment" i] span',
      authorLinkSelector: '.update-components-actor__image a, .update-components-actor__title a'
    },
    facebook: {
      editableFields: [
        '[aria-label*="Post"][role="textbox"]',
        '[aria-label*="comment"][role="textbox"]',
        '[data-text="true"]',
        '[contenteditable="true"][aria-label*="Write"]'
      ],
      postContainers: [
        '[data-pagelet*="feed"] [role="article"]',
        '[aria-label*="Comment"]'
      ],
      authorSelector: 'a[role="link"] span a span, h4 a span',
      personality: 'You are writing for Facebook. The tone should be friendly, conversational, and engaging. Content should feel natural and encourage interaction.',
      postSelector: 'div[data-pagelet] [role="article"]',
      commentButtonSelector: '[aria-label*="Comment"][role="button"]',
      replyFieldSelector: '[contenteditable="true"][role="textbox"]',
      submitButtonSelector: '[aria-label*="Comment"][role="button"]:not([aria-label*="Comment for"]), [aria-label*="Post"][role="button"]',
      reactionCountSelector: '[aria-label*="react" i], [aria-label*="Like" i] span',
      commentCountSelector: '[aria-label*="Comment" i][role="button"]',
      groupLinkSelector: 'a[href*="/groups/"]'
    },
    x: {
      editableFields: [
        '[data-testid="tweetTextarea_0"]',
        '[data-testid="tweetTextarea_1"]',
        '.public-DraftEditor-content[contenteditable="true"]',
        '[placeholder*="Tweet"]',
        '[aria-label*="Tweet text"]'
      ],
      postContainers: [
        '[data-testid="tweet"]',
        'article[data-testid="tweet"]'
      ],
      authorSelector: '[data-testid="User-Name"] a span',
      personality: 'You are writing for X (Twitter). Be concise, punchy, and impactful. Respect the character-limited culture even when writing longer posts.',
      postSelector: 'article[data-testid="tweet"]',
      commentButtonSelector: '[data-testid="reply"]',
      replyFieldSelector: '[data-testid="tweetTextarea_0"], .public-DraftEditor-content[contenteditable="true"]',
      submitButtonSelector: '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]',
      likeCountSelector: '[data-testid="like"], [data-testid="unlike"]',
      retweetCountSelector: '[data-testid="retweet"], [data-testid="unretweet"]',
      handleSelector: '[data-testid="User-Name"] a'
    },
    reddit: {
      editableFields: [
        'textarea[placeholder*="comment" i]',
        'textarea[placeholder*="What" i]',
        '[role="textbox"][contenteditable="true"]',
        'textarea[name="text"]',
        'textarea#comment-textarea',
        '.notreview-textarea',
        'textarea[class*="comment"]',
        '.public-DraftEditor-content[contenteditable="true"]',
        '[contenteditable="true"][data-placeholder]',
        '.md textarea',
        '[contenteditable="true"]'
      ],
      postContainers: [
        'shreddit-post',
        '[data-testid="post-container"]',
        '.Post',
        '.thing.link',
        '.thing.comment',
        '.Comment'
      ],
      authorSelector: '.author, a[data-testid="post_author_link"], [data-testid="comment_author_link"]',
      personality: 'You are writing for Reddit. Be authentic, knowledgeable, and community-aware. Match the subreddit culture. Avoid overly marketing language. Use proper formatting with Markdown.',
      postSelector: 'shreddit-post, [data-testid="post-container"], .Post, .thing.link',
      commentButtonSelector: 'a[slot="comments-link"], button[onclick*="comment"], [data-testid="comment-button"], a[aria-label*="comment" i], button[aria-label*="comment" i], a[href*="/comments/"]',
      replyFieldSelector: 'textarea[name="text"], textarea#comment-textarea, .public-DraftEditor-content[contenteditable="true"], textarea[placeholder*="comment" i], [contenteditable="true"][data-placeholder], textarea[placeholder*="What" i], [role="textbox"][contenteditable="true"]',
      submitButtonSelector: 'button[type="submit"]',
      scoreSelector: '.score, [aria-label="upvote"] + div[title], .score.unvoted',
      commentLinkSelector: 'a.comments, [data-testid="post-comment-link"], a[href*="/comments/"]',
      subredditSelector: 'a[href*="/r/"], a[data-click-id="subreddit"]',
      redditCommentButtonSelectors: [
        'a[slot="comments-link"]',
        'button[aria-label*="comment" i]',
        'a[aria-label*="comment" i]',
        'a[href*="/comments/"]',
        'button[onclick*="comment"]',
        '[data-testid="comment-button"]',
        'a.comments'
      ],
      redditSubmitButtonSelectors: [
        'button[type="submit"]',
        'button[aria-label*="comment" i]',
        'button[aria-label*="reply" i]',
        'button[aria-label*="Comment"]',
        'button[aria-label*="Reply"]'
      ]
    }
  };

  // ── Context extraction ──

  function querySelectorDeep(el, selector) {
    var result = el.querySelector(selector);
    if (result) return result;
    if (el.shadowRoot) {
      result = el.shadowRoot.querySelector(selector);
      if (result) return result;
    }
    var children = el.querySelectorAll('*');
    for (var i = 0; i < children.length; i++) {
      if (children[i].shadowRoot) {
        result = children[i].shadowRoot.querySelector(selector);
        if (result) return result;
      }
    }
    return null;
  }

  function querySelectorAllDeep(el, selector) {
    var results = [];
    var light = el.querySelectorAll(selector);
    for (var i = 0; i < light.length; i++) results.push(light[i]);
    if (el.shadowRoot) {
      var sr = el.shadowRoot.querySelectorAll(selector);
      for (var j = 0; j < sr.length; j++) results.push(sr[j]);
    }
    var children = el.querySelectorAll('*');
    for (var k = 0; k < children.length; k++) {
      if (children[k].shadowRoot) {
        var csr = children[k].shadowRoot.querySelectorAll(selector);
        for (var l = 0; l < csr.length; l++) results.push(csr[l]);
      }
    }
    return results;
  }

  function querySelectorDeepRecursive(el, selector, maxDepth) {
    maxDepth = maxDepth || 5;
    if (maxDepth <= 0 || !el) return null;
    var result = el.querySelector(selector);
    if (result) return result;
    var roots = [];
    if (el.shadowRoot) roots.push(el.shadowRoot);
    var children = el.querySelectorAll('*');
    for (var i = 0; i < children.length; i++) {
      if (children[i].shadowRoot) roots.push(children[i].shadowRoot);
    }
    for (var j = 0; j < roots.length; j++) {
      result = roots[j].querySelector(selector);
      if (result) return result;
      var srChildren = roots[j].querySelectorAll('*');
      for (var k = 0; k < srChildren.length; k++) {
        if (srChildren[k].shadowRoot) {
          result = querySelectorDeepRecursive(srChildren[k], selector, maxDepth - 1);
          if (result) return result;
        }
      }
    }
    return null;
  }

  function querySelectorAllDeepRecursive(el, selector, maxDepth) {
    maxDepth = maxDepth || 5;
    var results = [];
    if (maxDepth <= 0 || !el) return results;
    var light = el.querySelectorAll(selector);
    for (var i = 0; i < light.length; i++) results.push(light[i]);
    var roots = [];
    if (el.shadowRoot) roots.push(el.shadowRoot);
    var children = el.querySelectorAll('*');
    for (var j = 0; j < children.length; j++) {
      if (children[j].shadowRoot) roots.push(children[j].shadowRoot);
    }
    for (var m = 0; m < roots.length; m++) {
      var sr = roots[m].querySelectorAll(selector);
      for (var n = 0; n < sr.length; n++) results.push(sr[n]);
      var srChildren = roots[m].querySelectorAll('*');
      for (var p = 0; p < srChildren.length; p++) {
        if (srChildren[p].shadowRoot) {
          var nested = querySelectorAllDeepRecursive(srChildren[p], selector, maxDepth - 1);
          for (var q = 0; q < nested.length; q++) results.push(nested[q]);
        }
      }
    }
    return results;
  }

  function extractShadowText(el, maxLength) {
    maxLength = maxLength || 2000;
    if (!el) return '';
    var parts = [];
    function walk(node) {
      if (!node || parts.join(' ').length >= maxLength) return;
      if (node.nodeType === 3) {
        var t = node.textContent.trim();
        if (t) parts.push(t);
        return;
      }
      if (node.nodeType !== 1) return;
      var tag = node.tagName ? node.tagName.toLowerCase() : '';
      if (tag === 'script' || tag === 'style' || tag === 'template') return;
      for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
      if (node.shadowRoot) {
        for (var j = 0; j < node.shadowRoot.childNodes.length; j++) walk(node.shadowRoot.childNodes[j]);
      }
    }
    walk(el);
    var text = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (text.length > maxLength) text = text.substring(0, maxLength) + '...';
    return text;
  }
  function getSelectedText() {
    var sel = window.getSelection();
    return sel ? sel.toString().trim() : '';
  }

  function findNearestAncestor(element, selectors, maxDepth) {
    maxDepth = maxDepth || 15;
    var current = element;
    var depth = 0;
    while (current && current !== document.body && depth < maxDepth) {
      for (var i = 0; i < selectors.length; i++) {
        if (current.matches && current.matches(selectors[i])) return current;
      }
      current = current.parentElement;
      depth++;
    }
    return null;
  }

  function extractText(el, maxLength) {
    maxLength = maxLength || 2000;
    if (!el) return '';
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'shreddit-post') {
      var parts = [];
      var titleAttr = el.getAttribute('post-title') || el.getAttribute('title') || '';
      if (titleAttr) parts.push(titleAttr);
      var innerText = (el.innerText || '').trim();
      if (innerText && innerText.length > titleAttr.length) {
        parts.push(innerText);
      } else {
        var sText = extractShadowText(el, maxLength);
        if (sText && sText.length > titleAttr.length) parts.push(sText);
      }
      var text = parts.join('\n').trim();
      if (text.length > maxLength) text = text.substring(0, maxLength) + '...';
      return text;
    }
    var text = (el.innerText || el.textContent || '').trim();
    if (text.length > maxLength) text = text.substring(0, maxLength) + '...';
    return text;
  }

  function extractContext(activeEl) {
    var result = { postText: '', author: '', nearbyComments: [], selectedText: '' };
    if (!activeEl || !platformConfig) return result;

    result.selectedText = getSelectedText();

    var postEl = findNearestAncestor(activeEl, platformConfig.postContainers, 20);

    // Reddit fallback: if no ancestor found, find nearest shreddit-post by visual position
    if (!postEl && platformName === 'reddit') {
      var fieldRect = activeEl.getBoundingClientRect();
      var allPosts = document.querySelectorAll('shreddit-post, [data-testid="post-container"], .Post, .thing.link');
      var bestPost = null, bestDist = Infinity;
      for (var pi = 0; pi < allPosts.length; pi++) {
        var pr = allPosts[pi].getBoundingClientRect();
        if (pr.height === 0) continue;
        var dy = Math.abs(fieldRect.top - pr.top);
        var dx = Math.abs(fieldRect.left - pr.left);
        var dist = dy + dx * 0.5;
        if (dist < bestDist) { bestDist = dist; bestPost = allPosts[pi]; }
      }
      postEl = bestPost;
      // Also try walking through shadow root boundaries
      if (!postEl) {
        var current = activeEl;
        var depth = 0;
        while (current && current !== document.body && depth < 30) {
          var parent = current.parentElement;
          if (!parent && current.parentNode) {
            var root = current.getRootNode && current.getRootNode();
            if (root && root.host) parent = root.host;
          }
          if (parent && parent.tagName && parent.tagName.toLowerCase() === 'shreddit-post') {
            postEl = parent;
            break;
          }
          current = parent;
          depth++;
        }
      }
    }

    if (postEl) {
      result.postText = extractText(postEl);
      if (platformConfig.authorSelector) {
        var authorEls = postEl.querySelectorAll(platformConfig.authorSelector);
        if (authorEls.length > 0) {
          result.author = (authorEls[0].innerText || authorEls[0].textContent || '').trim();
        }
      }
      // For shreddit-post, also get author from attributes
      if (!result.author && postEl.getAttribute) {
        var authorAttr = postEl.getAttribute('author');
        if (authorAttr) result.author = authorAttr;
      }
      var siblings = postEl.parentElement ? postEl.parentElement.children : [];
      var comments = [];
      for (var i = 0; i < siblings.length && comments.length < 5; i++) {
        if (siblings[i] !== postEl) {
          for (var j = 0; j < platformConfig.postContainers.length; j++) {
            if (siblings[i].matches && siblings[i].matches(platformConfig.postContainers[j])) {
              var ct = extractText(siblings[i], 500);
              if (ct) comments.push(ct);
              break;
            }
          }
        }
      }
      result.nearbyComments = comments;
    } else {
      var ft = extractText(activeEl, 1000);
      if (ft) result.postText = ft;
    }
    return result;
  }

  // ── UI ──
  // Walk up from clicked element to find the nearest editable field container
  function findEditableField(el) {
    if (!platformConfig) return null;
    var current = el;
    var depth = 0;
    while (current && current !== document.body && depth < 20) {
      if (current.matches) {
        // Check platform-specific selectors
        for (var i = 0; i < platformConfig.editableFields.length; i++) {
          if (current.matches(platformConfig.editableFields[i])) return current;
        }
        // Generic contenteditable fallback
        if (current.getAttribute && current.getAttribute('contenteditable') === 'true') return current;
        // Role textbox (used by Reddit, LinkedIn, and many modern editors)
        if (current.getAttribute && current.getAttribute('role') === 'textbox') return current;
      }
      // Textareas and text inputs
      if (current.tagName === 'TEXTAREA') return current;
      if (current.tagName === 'INPUT' && (current.type === 'text' || current.type === 'search')) return current;
      current = current.parentElement;
      depth++;
    }
    return null;
  }

  function removeExistingTrigger() {
    if (currentTriggerWrapper && currentTriggerWrapper.parentNode) {
      currentTriggerWrapper.parentNode.removeChild(currentTriggerWrapper);
    }
    currentTriggerWrapper = null;
  }

  function hidePopover() {
    if (currentPopoverEl) {
      // Use remove() to trigger drag listener cleanup from makeDraggable
      if (currentPopoverEl.remove) {
        currentPopoverEl.remove();
      } else if (currentPopoverEl.parentNode) {
        currentPopoverEl.parentNode.removeChild(currentPopoverEl);
      }
    }
    currentPopoverEl = null;
  }

  function createTriggerForField(field) {
    removeExistingTrigger();
    hidePopover();

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'saic-trigger';
    trigger.setAttribute('aria-label', 'Open AI Copilot');
    trigger.setAttribute('title', 'AI Copilot (Ctrl+Shift+A)');
    trigger.textContent = 'AI';

    var wrapper = document.createElement('div');
    wrapper.className = 'saic-trigger-wrapper';
    wrapper.appendChild(trigger);

    field.parentNode.insertBefore(wrapper, field.nextSibling);

    var rect = field.getBoundingClientRect();
    wrapper.style.position = 'fixed';
    wrapper.style.left = (rect.right - 44) + 'px';
    wrapper.style.top = (rect.bottom + 4) + 'px';
    wrapper.style.zIndex = '999998';

    currentTriggerWrapper = wrapper;
    activeField = field;

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openPopover(field);
    });

    return { trigger: trigger, wrapper: wrapper, field: field };
  }

  // ── Drag functionality ──
  function makeDraggable(el, handle) {
    var isDragging = false;
    var startX = 0;
    var startY = 0;
    var startLeft = 0;
    var startTop = 0;

    function onMouseDown(e) {
      // Don't drag if clicking close button or interactive elements
      if (e.target.closest('.saic-popover-close') || e.target.closest('button:not(.saic-popover-header)') || e.target.closest('select')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = el.offsetLeft;
      startTop = el.offsetTop;
      handle.style.cursor = 'grabbing';
      e.preventDefault();
    }

    function onMouseMove(e) {
      if (!isDragging) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      el.style.left = (startLeft + dx) + 'px';
      el.style.top = (startTop + dy) + 'px';
    }

    function onMouseUp() {
      if (!isDragging) return;
      isDragging = false;
      handle.style.cursor = 'grab';
    }

    handle.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Cleanup when popover is removed
    var origRemove = el.remove.bind(el);
    el.remove = function () {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      origRemove();
    };
  }

  function openPopover(field) {
    hidePopover();
    removeExistingTrigger();
    activeField = field;

    var popover = document.createElement('div');
    popover.className = 'saic-popover';
    popover.style.position = 'fixed';
    popover.style.zIndex = '999999';

    // --- Close button (visible on hover of popover) ---
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'saic-popover-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      hidePopover();
    });
    popover.appendChild(closeBtn);

    // --- Drag handle header ---
    var header = document.createElement('div');
    header.className = 'saic-popover-header';
    header.textContent = '\u2728 AI Copilot';
    popover.appendChild(header);

    // --- Slim toolbar ---
    var toolbar = document.createElement('div');
    toolbar.className = 'saic-toolbar';

    var primaryActions = [
      { id: 'reply', label: 'Reply' },
      { id: 'comment', label: 'Comment' },
      { id: 'quick_reply', label: 'Quick' },
      { id: 'post', label: 'Post' },
      { id: 'rewrite', label: 'Rewrite' }
    ];

    var moreActions = [
      { id: 'hook', label: 'Hook' },
      { id: 'shorten', label: 'Shorten' },
      { id: 'expand', label: 'Expand' },
      { id: 'grammar', label: 'Grammar' },
      { id: 'summarize', label: 'Summarize' }
    ];

    // Result card + action row (hidden initially)
    var resultCard = document.createElement('div');
    resultCard.className = 'saic-result-card';
    resultCard.style.display = 'none';

    var resultActions = document.createElement('div');
    resultActions.className = 'saic-result-actions';
    resultActions.style.display = 'none';

    var insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.className = 'saic-insert-btn';
    insertBtn.textContent = 'Insert';

    var regenBtn = document.createElement('button');
    regenBtn.type = 'button';
    regenBtn.className = 'saic-regen-btn';
    regenBtn.textContent = 'Regenerate';

    resultActions.appendChild(insertBtn);
    resultActions.appendChild(regenBtn);

    primaryActions.forEach(function (action) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'saic-chip';
      chip.textContent = action.label;
      chip.addEventListener('click', function () { handleChipClick(action.id); });
      toolbar.appendChild(chip);
    });

    // More button + dropdown
    var moreWrapper = document.createElement('div');
    moreWrapper.style.position = 'relative';

    var moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'saic-chip saic-chip-more';
    moreBtn.textContent = 'More...';
    moreWrapper.appendChild(moreBtn);

    var moreMenu = document.createElement('div');
    moreMenu.className = 'saic-more-menu';
    moreMenu.style.display = 'none';

    moreActions.forEach(function (action) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'saic-chip';
      chip.textContent = action.label;
      chip.addEventListener('click', function () {
        handleChipClick(action.id);
        moreMenu.style.display = 'none';
      });
      moreMenu.appendChild(chip);
    });

    moreWrapper.appendChild(moreMenu);
    toolbar.appendChild(moreWrapper);

    moreBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      moreMenu.style.display = moreMenu.style.display === 'none' ? 'flex' : 'none';
    });

    // Tone + Context selector row (side by side)
    var selectRow = document.createElement('div');
    selectRow.className = 'saic-select-row';

    var toneSelect = document.createElement('select');
    toneSelect.className = 'saic-tone-select';
    var defaultTone = ((savedSettings && savedSettings.platformSettings && savedSettings.platformSettings[platformName]) || {}).tone || 'casual';
    var platformInstr = ((savedSettings && savedSettings.platformSettings && savedSettings.platformSettings[platformName]) || {});
    var instructionPresets = platformInstr.instructionPresets || [];
    var customInstructions = platformInstr.customInstructions || '';
    ['casual', 'funny', 'informative'].forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      if (t === defaultTone) opt.selected = true;
      toneSelect.appendChild(opt);
    });
    selectRow.appendChild(toneSelect);

    // Context selector (only shown when contexts exist)
    var allContexts = (savedSettings && savedSettings.contexts) || [];
    var platformActiveContextId = platformInstr.activeContext || '';
    var defaultCtxId = platformActiveContextId;
    var contextSelect = null;
    if (allContexts.length > 0) {
      contextSelect = document.createElement('select');
      contextSelect.className = 'saic-context-select';
      var noCtxOpt = document.createElement('option');
      noCtxOpt.value = '';
      noCtxOpt.textContent = 'No Context';
      contextSelect.appendChild(noCtxOpt);
      allContexts.forEach(function (ctx) {
        var opt = document.createElement('option');
        opt.value = ctx.id;
        opt.textContent = ctx.name;
        if (ctx.id === platformActiveContextId) {
          opt.selected = true;
        }
        contextSelect.appendChild(opt);
      });
      selectRow.appendChild(contextSelect);
    }
    toolbar.appendChild(selectRow);

    // ── Post writing panel (different UI for post task) ──
    var postPanel = document.createElement('div');
    postPanel.className = 'saic-post-panel';
    postPanel.style.display = 'none';

    var postPanelLabel = document.createElement('div');
    postPanelLabel.className = 'saic-post-panel-label';
    postPanelLabel.textContent = 'What do you want to post about?';
    postPanel.appendChild(postPanelLabel);

    var postInput = document.createElement('textarea');
    postInput.className = 'saic-post-input';
    postInput.placeholder = 'Describe your topic, paste a draft, or add key points...';
    postInput.rows = 3;
    postInput.addEventListener('input', function () {
      postInput.style.borderColor = '';
    });
    postPanel.appendChild(postInput);

    // Context pills row for post panel (only when contexts exist)
    var postCtxRow = document.createElement('div');
    postCtxRow.className = 'saic-post-ctx-row';
    var postSelectedCtxIds = [];
    if (allContexts.length > 0) {
      var postCtxLabel = document.createElement('span');
      postCtxLabel.className = 'saic-post-ctx-label';
      postCtxLabel.textContent = 'Contexts:';
      postCtxRow.appendChild(postCtxLabel);
      if (defaultCtxId) postSelectedCtxIds.push(defaultCtxId);

      allContexts.forEach(function (ctx) {
        var pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'saic-ctx-pill' + (postSelectedCtxIds.indexOf(ctx.id) !== -1 ? ' saic-ctx-pill-active' : '');
        pill.textContent = ctx.name;
        pill.dataset.ctxId = ctx.id;
        pill.addEventListener('click', function () {
          var idx = postSelectedCtxIds.indexOf(ctx.id);
          if (idx !== -1) {
            postSelectedCtxIds.splice(idx, 1);
            pill.classList.remove('saic-ctx-pill-active');
          } else {
            postSelectedCtxIds.push(ctx.id);
            pill.classList.add('saic-ctx-pill-active');
          }
        });
        postCtxRow.appendChild(pill);
      });
      postPanel.appendChild(postCtxRow);
    }

    var postActionsRow = document.createElement('div');
    postActionsRow.className = 'saic-post-actions-row';
    var postGenerateBtn = document.createElement('button');
    postGenerateBtn.type = 'button';
    postGenerateBtn.className = 'saic-insert-btn';
    postGenerateBtn.style.flex = '1';
    postGenerateBtn.textContent = 'Generate Post';
    postActionsRow.appendChild(postGenerateBtn);
    postPanel.appendChild(postActionsRow);

    popover.appendChild(toolbar);
    popover.appendChild(postPanel);
    popover.appendChild(resultCard);
    popover.appendChild(resultActions);

    // ── Post mode toggle ──
    var isPostMode = false;
    function setPostMode(on) {
      isPostMode = on;
      postPanel.style.display = on ? 'block' : 'none';
      // Hide normal result area in post mode until generated
      if (on) {
        resultCard.style.display = 'none';
        resultActions.style.display = 'none';
      }
    }

    // Override chip click to handle post mode
    function handleChipClick(actionId) {
      if (actionId === 'post') {
        setPostMode(true);
        postInput.focus();
        return;
      }
      setPostMode(false);
      handleAction(actionId, toneSelect.value, contextSelect ? contextSelect.value : '', field, resultCard, insertBtn, regenBtn, resultActions, instructionPresets, customInstructions);
    }

    // Post generate handler
    postGenerateBtn.addEventListener('click', function () {
      var userTopic = postInput.value.trim();
      if (!userTopic) {
        postInput.style.borderColor = '#ef4444';
        return;
      }
      postInput.style.borderColor = '#e2e8f0';

      // Collect selected contexts
      var selectedCtxTexts = [];
      postSelectedCtxIds.forEach(function (cid) {
        var match = allContexts.find(function (c) { return c.id === cid; });
        if (match) selectedCtxTexts.push(match.body);
      });

      resultCard.style.display = 'block';
      resultCard.textContent = 'Generating...';
      resultCard.className = 'saic-result-card saic-loading';
      resultActions.style.display = 'none';

      lastGeneratedAction = 'post';
      lastGeneratedTone = toneSelect.value;

      // Check extension context validity
      if (!chrome.runtime || !chrome.runtime.id) {
        resultCard.textContent = 'Error: Extension context lost. Please reload the page and try again.';
        resultCard.className = 'saic-result-card saic-error';
        return;
      }

      // Build context with user's topic
      var postContext = {
        postText: userTopic,
        author: '',
        nearbyComments: [],
        selectedText: '',
        extraContexts: selectedCtxTexts
      };

      var postTimedOut = false;
      var postTimeout = setTimeout(function () {
        postTimedOut = true;
        resultCard.textContent = 'Error: Request timed out. The API took too long to respond. Try a different model or check your API key.';
        resultCard.className = 'saic-result-card saic-error';
      }, 60000);

      console.log('[SAIC] Sending post generate request');

      chrome.runtime.sendMessage({
        type: 'generate',
        data: {
          platform: platformName,
          task: 'post',
          tone: toneSelect.value,
          context: postContext,
          personality: platformConfig ? platformConfig.personality : '',
          contextInfo: selectedCtxTexts.join('\n'),
          mentionPages: ((savedSettings && savedSettings.platformSettings && savedSettings.platformSettings[platformName]) || {}).mentionPages || [],
          instructionPresets: instructionPresets,
          customInstructions: customInstructions
        }
      }, function (response) {
        clearTimeout(postTimeout);
        if (postTimedOut) return;

        console.log('[SAIC] Post response received:', response ? (response.error ? 'error' : 'text:' + (response.text || '').length) : 'null');

        if (chrome.runtime.lastError) {
          resultCard.textContent = 'Error: ' + chrome.runtime.lastError.message;
          resultCard.className = 'saic-result-card saic-error';
          return;
        }
        if (response && response.error) {
          resultCard.textContent = 'Error: ' + response.error;
          resultCard.className = 'saic-result-card saic-error';
          return;
        }
        if (response && response.text) {
          lastGeneratedText = response.text;
          resultCard.textContent = response.text;
          resultCard.className = 'saic-result-card';
          resultActions.style.display = 'flex';

          var newInsertBtn = insertBtn.cloneNode(true);
          insertBtn.parentNode.replaceChild(newInsertBtn, insertBtn);
          newInsertBtn.addEventListener('click', function () {
            insertTextAtCursor(field, response.text);
            hidePopover();
          });

          var newRegenBtn = regenBtn.cloneNode(true);
          regenBtn.parentNode.replaceChild(newRegenBtn, regenBtn);
          newRegenBtn.addEventListener('click', function () {
            postGenerateBtn.click();
          });
        } else {
          resultCard.textContent = 'Error: No response received from the AI. Please check your API key and model settings.';
          resultCard.className = 'saic-result-card saic-error';
        }
      });
    });

    // Position near the field
    var rect = field.getBoundingClientRect();
    var left = Math.max(8, rect.left);
    var top = rect.bottom + 8;

    // Keep within viewport
    if (left + 384 > window.innerWidth) {
      left = Math.max(8, window.innerWidth - 392);
    }
    // Initial height estimate — post mode adds ~180px dynamically
    if (top + 280 > window.innerHeight) {
      top = Math.max(8, rect.top - 280);
    }

    popover.style.left = left + 'px';
    popover.style.top = top + 'px';

    document.body.appendChild(popover);
    currentPopoverEl = popover;

    // Make draggable via header
    makeDraggable(popover, header);
  }

  // ── Action handler ──
  function handleAction(task, tone, contextId, field, resultCard, insertBtn, regenBtn, resultActions, activePresets, activeCustomInstr) {
    try {
      var context = extractContext(field);

      // Resolve context info — only use what's explicitly selected
      var contextInfo = '';
      if (contextId) {
        var allCtxs = (savedSettings && savedSettings.contexts) || [];
        var match = allCtxs.find(function (c) { return c.id === contextId; });
        if (match) contextInfo = match.body;
      }

      resultCard.style.display = 'block';
      resultCard.textContent = 'Generating...';
      resultCard.className = 'saic-result-card saic-loading';
      resultActions.style.display = 'none';

      lastGeneratedAction = task;
      lastGeneratedTone = tone;

      // Check extension context validity
      if (!chrome.runtime || !chrome.runtime.id) {
        resultCard.textContent = 'Error: Extension context lost. Please reload the page and try again.';
        resultCard.className = 'saic-result-card saic-error';
        return;
      }

      // Send to background.js
      var generateTimedOut = false;
      var generateTimeout = setTimeout(function () {
        generateTimedOut = true;
        resultCard.textContent = 'Error: Request timed out. The API took too long to respond. Try a different model or check your API key.';
        resultCard.className = 'saic-result-card saic-error';
      }, 60000);

      var messageData = {
        platform: platformName,
        task: task,
        tone: tone,
        context: context,
        personality: platformConfig ? platformConfig.personality : '',
        contextInfo: contextInfo,
        mentionPages: ((savedSettings && savedSettings.platformSettings && savedSettings.platformSettings[platformName]) || {}).mentionPages || [],
        instructionPresets: activePresets || [],
        customInstructions: activeCustomInstr || ''
      };

      console.log('[SAIC] Sending generate request:', task, platformName);

      chrome.runtime.sendMessage({
        type: 'generate',
        data: messageData
      }, function (response) {
        clearTimeout(generateTimeout);
        if (generateTimedOut) return;

        console.log('[SAIC] Response received:', response ? (response.error ? 'error' : 'text:' + (response.text || '').length) : 'null');

        if (chrome.runtime.lastError) {
          resultCard.textContent = 'Error: ' + chrome.runtime.lastError.message;
          resultCard.className = 'saic-result-card saic-error';
          return;
        }
        if (response && response.error) {
          resultCard.textContent = 'Error: ' + response.error;
          resultCard.className = 'saic-result-card saic-error';
          return;
        }
        if (response && response.text) {
          lastGeneratedText = response.text;
          resultCard.textContent = response.text;
          resultCard.className = 'saic-result-card';
          resultActions.style.display = 'flex';

          // Insert handler
          var newInsertBtn = insertBtn.cloneNode(true);
          insertBtn.parentNode.replaceChild(newInsertBtn, insertBtn);
          newInsertBtn.addEventListener('click', function () {
            insertTextAtCursor(field, response.text);
            hidePopover();
          });

          // Regenerate handler
          var newRegenBtn = regenBtn.cloneNode(true);
          regenBtn.parentNode.replaceChild(newRegenBtn, regenBtn);
          newRegenBtn.addEventListener('click', function () {
            handleAction(lastGeneratedAction, lastGeneratedTone, contextId, field, resultCard, newInsertBtn, newRegenBtn, resultActions, activePresets, activeCustomInstr);
          });
        } else {
          resultCard.textContent = 'Error: No response received from the AI. Please check your API key and model settings.';
          resultCard.className = 'saic-result-card saic-error';
        }
      });
    } catch (err) {
      console.error('[SAIC] handleAction error:', err);
      resultCard.textContent = 'Error: ' + err.message;
      resultCard.className = 'saic-result-card saic-error';
    }
  }

  // ── Double-click listener ──
  function setupDblClickListener() {
    document.addEventListener('dblclick', handleDblClick, true);
  }

  // ── Keyboard shortcut handler (from background.js command) ──
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.type === 'triggerShortcut') {
      if (activeField) {
        openPopover(activeField);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'No active editable field found. Double-click a comment or post box first.' });
      }
    }
  });

  // ── Click outside to close ──
  document.addEventListener('click', function (e) {
    if (currentPopoverEl && !currentPopoverEl.contains(e.target)) {
      hidePopover();
    }
    // Close any open More menus when clicking outside
    var openMenus = document.querySelectorAll('.saic-more-menu');
    for (var i = 0; i < openMenus.length; i++) {
      if (!openMenus[i].parentNode.contains(e.target)) {
        openMenus[i].style.display = 'none';
      }
    }
  });

  // ── Track last focused editable field for keyboard shortcut ──
  document.addEventListener('focusin', function (e) {
    var field = findEditableField(e.target);
    if (field) activeField = field;
  });

  // ── Initialization ──
  function init() {
    platformName = detectPlatform(window.location.href);
    if (!platformName) return;

    platformConfig = PLATFORMS[platformName];
    if (!platformConfig) return;

    // Set up listeners immediately — don't gate on storage
    setupDblClickListener();

    // Load settings asynchronously (tone defaults, platform toggle)
    chrome.runtime.sendMessage({ type: 'getSettings' }, function (settings) {
      if (chrome.runtime.lastError || !settings) {
        return;
      }
      var platforms = settings.platforms || {};
      if (platforms[platformName] === false) {
        // Platform disabled — remove listener
        document.removeEventListener('dblclick', handleDblClick, true);
        return;
      }
      savedSettings = settings;
      // Initialize automation engine after settings are loaded
      AutomationEngine.init();
    });

    // Keep settings fresh on changes
    chrome.storage.onChanged.addListener(function (changes) {
      if (changes.socialAiCopilot_settings) {
        savedSettings = changes.socialAiCopilot_settings.newValue || {};
      }
    });
  }

  // Named handler so we can remove it if platform is disabled
  function handleDblClick(e) {
    var field = findEditableField(e.target);
    if (field) {
      e.preventDefault();
      e.stopPropagation();
      openPopover(field);
    }
  }

  // ══════════════════════════════════════════════════
  // ── Background Tab Timer (Web Worker) ──
  // Browsers freeze requestAnimationFrame and throttle setTimeout
  // in background tabs. A Web Worker runs in a separate thread
  // and is NOT subject to these throttling policies.
  // ══════════════════════════════════════════════════
  var _bgTimerCode = [
    'var _t={};var _n=0;',
    'self.onmessage=function(e){',
    '  if(e.data.cmd==="set"){',
    '    var id=++_n;',
    '    _t[id]=setTimeout(function(){self.postMessage({evt:"fire",id:id});delete _t[id];},e.data.ms);',
    '  }else if(e.data.cmd==="clear"){',
    '    if(_t[e.data.id]!==undefined){clearTimeout(_t[e.data.id]);delete _t[e.data.id];}',
    '  }',
    '};'
  ].join('\n');
  var _bgTimerBlob = new Blob([_bgTimerCode], { type: 'application/javascript' });
  var _bgTimerWorker = new Worker(URL.createObjectURL(_bgTimerBlob));
  var _bgTimerCbs = {};
  var _bgTimerSeq = 0;

  function bgTimeout(fn, ms) {
    var id = ++_bgTimerSeq;
    _bgTimerCbs[id] = fn;
    _bgTimerWorker.postMessage({ cmd: 'set', id: id, ms: ms });
    return id;
  }

  function bgClear(id) {
    if (id) { delete _bgTimerCbs[id]; _bgTimerWorker.postMessage({ cmd: 'clear', id: id }); }
  }

  _bgTimerWorker.onmessage = function (e) {
    var cb = _bgTimerCbs[e.data.id];
    if (cb) { delete _bgTimerCbs[e.data.id]; cb(); }
  };

  // ══════════════════════════════════════════════════
  // ── Automation Engine ──
  // ══════════════════════════════════════════════════


  var AutomationEngine = {
    state: 'idle',
    config: {
      interval: 60,
      minInterval: 30,
      maxInterval: 300,
      stopLimit: 0,
      autoSubmit: true,
      contentFilter: 'business',
      engagementThresholds: {
        linkedin:  { minReactions: 50, minComments: 10 },
        facebook:  { minReactions: 30, minComments: 5 },
        x:         { minLikes: 100, minRetweets: 20 },
        reddit:    { minUpvotes: 50, minComments: 10 }
      },
      priorityTargets: [],
      autoMentionPages: []
    },
    stats: { commentsMade: 0, startTime: null, postsScanned: 0, postsSkipped: 0 },
    processedPosts: new Set(),
    _confirmed: false,
    panelEl: null,
    btnEl: null,
    timerInterval: null,
    nextActionTimeout: null,
    countdownInterval: null,
    _cdBgTimer: null,
    nextActionTime: null,
    _abortScroll: false,
    logEntries: [],
    commentHistory: [],

    loadConfig: function () {
      var settings = savedSettings || {};
      var ps = (settings.platformSettings && settings.platformSettings[platformName]) || {};
      this.config.interval = Math.max(30, Math.min(300, ps.interval || 60));
      this.config.stopLimit = Math.max(0, ps.stopLimit || 0);
      this.config.autoSubmit = ps.autoSubmit !== false;
      this.config.contentFilter = ps.contentFilter || 'business';
      this.config.engagementThresholds = {};
      this.config.engagementThresholds[platformName] = ps.engagementThresholds || {};
      if (settings.priorityTargets && settings.priorityTargets.length) {
        this.config.priorityTargets = settings.priorityTargets;
      }
      if (ps.mentionPages && ps.mentionPages.length) {
        this.config.autoMentionPages = ps.mentionPages;
      }
    },

    start: function () {
      if (!this._confirmed) {
        if (!confirm('Automated commenting may violate platform Terms of Service and could result in account suspension or permanent ban.\n\nAI-generated comments may need to be disclosed under FTC and EU regulations.\n\nContinue?')) return;
        this._confirmed = true;
      }
      bgClear(this.nextActionTimeout);
      bgClear(this._cdBgTimer);
      clearInterval(this.countdownInterval);
      this.loadConfig();
      if (platformName === 'reddit') RedditAutoEngine.loadConfig();
      this.state = 'running';
      this.stats = { commentsMade: 0, startTime: Date.now(), postsScanned: 0, postsSkipped: 0 };
      this.processedPosts = new Set();
      this._abortScroll = false;
      this.logEntries = [];
      this.addLog('Started on ' + platformName + ' - interval: ' + this.config.interval + 's');
      console.log('[SAIC-Auto] Started - interval:', this.config.interval + 's, auto:', this.config.autoSubmit);
      this.updateUI();
      this.runCycle();
    },

    stop: function (reason) {
      this.state = 'stopped';
      this._abortScroll = true;
      bgClear(this.nextActionTimeout);
      bgClear(this._cdBgTimer);
      clearInterval(this.countdownInterval);
      this.nextActionTimeout = null;
      this.countdownInterval = null;
      this.nextActionTime = null;
      this.addLog('Stopped' + (reason ? ': ' + reason : ''));
      this.updateUI();
    },

    pause: function () {
      if (this.state !== 'running') return;
      this.state = 'paused';
      this._abortScroll = true;
      bgClear(this.nextActionTimeout);
      bgClear(this._cdBgTimer);
      clearInterval(this.countdownInterval);
      this.nextActionTimeout = null;
      this.countdownInterval = null;
      this.addLog('Paused at ' + this.stats.commentsMade + ' comments');
      this.updateUI();
    },

    resume: function () {
      if (this.state !== 'paused') return;
      this.state = 'running';
      this._abortScroll = false;
      this.addLog('Resumed');
      this.updateUI();
      this.runCycle();
    },

    runCycle: function () {
      var self = this;
      if (self.state !== 'running') return;
      if (self.config.stopLimit > 0 && self.stats.commentsMade >= self.config.stopLimit) {
        self.stop('limit reached (' + self.config.stopLimit + ')');
        return;
      }
      var posts = self.findCandidatePosts();
      if (posts.length === 0) {
        self.addLog('No posts found, scrolling...');
        self.humanScroll(window.scrollY + window.innerHeight * (1 + Math.random() * 2), function () {
          if (self.state !== 'running') return;
          bgTimeout(function () {
            posts = self.findCandidatePosts();
            if (posts.length === 0) {
              self.addLog('No posts after scroll, retry 10s');
              self.scheduleNextCycle(10000);
              return;
            }
            self.processBestPost(posts);
          }, 1500 + Math.random() * 1500);
        });
        return;
      }
      self.processBestPost(posts);
    },

    findCandidatePosts: function () {
      if (!platformConfig || !platformConfig.postSelector) return [];
      var all = document.querySelectorAll(platformConfig.postSelector);
      var candidates = [];
      for (var i = 0; i < all.length; i++) {
        if (!this.processedPosts.has(this.getPostFingerprint(all[i]))) candidates.push(all[i]);
      }
      return candidates;
    },

    processBestPost: function (posts) {
      var self = this;
      if (self.state !== 'running') return;
      var bestPost = null, bestScore = -1, bestReason = '';
      for (var i = 0; i < posts.length; i++) {
        var post = posts[i];
        if (self.isPriorityTarget(post)) { bestPost = post; bestReason = 'Priority target'; break; }
        var engagement = self.getEngagementScore(post);
        if (self.meetsEngagementThreshold(engagement) && engagement.total > bestScore) {
          bestScore = engagement.total;
          bestPost = post;
          bestReason = 'Engagement: ' + engagement.reactions + ' reactions, ' + engagement.comments + ' comments';
        }
      }
      if (!bestPost) {
        self.stats.postsSkipped++;
        self.addLog('All below threshold, scrolling...');
        self.humanScroll(window.scrollY + window.innerHeight * (1 + Math.random() * 1.5), function () {
          if (self.state !== 'running') return;
          self.scheduleNextCycle(jitter(3000, 0.3));
        });
        return;
      }
      // Delegate to RedditAutoEngine for Reddit-specific processing
      if (platformName === 'reddit') {
        RedditAutoEngine.loadConfig();
        RedditAutoEngine.processRedditPost(bestPost, bestReason);
        return;
      }
      self.processPost(bestPost, bestReason);
    },

    processPost: function (post, reason) {
      var self = this;
      if (self.state !== 'running') return;
      var postId = self.getPostFingerprint(post);
      self.processedPosts.add(postId);
      self.stats.postsScanned++;
      self.addLog(reason || 'Processing post');
      self.scrollToPost(post, function () {
        if (self.state !== 'running') return;
        var readDelay = jitter(randomBetween(3000, 8000), 0.15);
        self.updateCountdown(readDelay, 'Reading...');
        bgTimeout(function () {
          if (self.state !== 'running') return;
          if (!post.isConnected) { self.addLog('Post removed from DOM'); self.scheduleNextCycle(jitter(3000, 0.3)); return; }
          var context = self.extractPostContext(post);
          self.classifyAndComment(context, function (text) {
            if (self.state !== 'running') return;
            if (!text) {
              self.stats.postsSkipped++;
              self.addLog('Skipped: not business/startup related');
              self.scheduleNextCycle(jitter(5000, 0.3));
              return;
            }
            if (self.config.autoSubmit) {
              self.submitCommentAuto(post, text, function (success) { self.afterComment(success, text, post); });
            } else {
              self.showReviewOverlay(post, text, function (approved) {
                if (approved) { self.afterComment(true, text, post); }
                else { self.addLog('Skipped by user'); self.scheduleNextCycle(jitter(5000, 0.3)); }
              });
            }
          });
        }, readDelay);
      });
    },

    afterComment: function (success, text, postEl) {
      var self = this;
      if (success) {
        self.stats.commentsMade++;
        self.addLog('Commented: "' + (text || '').substring(0, 50) + '..."');
      } else {
        self.addLog('Failed to submit');
      }
      if (postEl) self.recordComment(postEl, text, success);
      self.updateUI();
      var extraPause = (self.stats.commentsMade % (5 + Math.floor(Math.random() * 4)) === 0) ? jitter(randomBetween(5000, 15000), 0.2) : 0;
      self.scheduleNextCycle(jitter(self.config.interval * 1000, 0.2) + extraPause);
    },

    scheduleNextCycle: function (delayMs) {
      var self = this;
      if (self.state !== 'running') return;
      console.log('[SAIC-Auto] Next in ' + Math.round(delayMs / 1000) + 's');
      self.updateCountdown(delayMs, 'Next in');
      self.nextActionTimeout = bgTimeout(function () { if (self.state === 'running') self.runCycle(); }, delayMs);
    },

    updateCountdown: function (totalMs, prefix) {
      var self = this;
      clearInterval(self.countdownInterval);
      bgClear(self._cdBgTimer);
      if (!self.panelEl) return;
      var timerEl = self.panelEl.querySelector('.saic-auto-timer');
      if (!timerEl) return;
      var remaining = totalMs;
      timerEl.textContent = prefix + ' ' + Math.ceil(remaining / 1000) + 's';
      function tick() {
        remaining -= 1000;
        if (remaining <= 0) { timerEl.textContent = 'Working...'; return; }
        timerEl.textContent = prefix + ' ' + Math.ceil(remaining / 1000) + 's';
        self._cdBgTimer = bgTimeout(tick, 1000);
      }
      self._cdBgTimer = bgTimeout(tick, 1000);
    },

    getEngagementScore: function (postEl) {
      var result = { reactions: 0, comments: 0, total: 0 };
      if (platformName === 'linkedin') {
        var rEl = postEl.querySelector(platformConfig.reactionCountSelector);
        if (rEl) result.reactions = extractCountFromEl(rEl);
        var cEl = postEl.querySelector(platformConfig.commentCountSelector);
        if (cEl) result.comments = extractCountFromEl(cEl);
      } else if (platformName === 'facebook') {
        var rEl2 = postEl.querySelector(platformConfig.reactionCountSelector);
        if (rEl2) result.reactions = extractCountFromEl(rEl2);
        var cEl2 = postEl.querySelector(platformConfig.commentCountSelector);
        if (cEl2) result.comments = extractCountFromEl(cEl2);
      } else if (platformName === 'x') {
        var lEl = postEl.querySelector(platformConfig.likeCountSelector);
        if (lEl) result.reactions = extractCountFromEl(lEl);
        var rtEl = postEl.querySelector(platformConfig.retweetCountSelector);
        if (rtEl) result.comments = extractCountFromEl(rtEl);
      } else if (platformName === 'reddit') {
        var shTag = postEl.tagName ? postEl.tagName.toLowerCase() : '';
        if (shTag === 'shreddit-post') {
          result.reactions = parseInt(postEl.getAttribute('score')) || 0;
          result.comments = parseInt(postEl.getAttribute('comment-count')) || 0;
        }
        if (result.reactions === 0) {
          var sEl = postEl.querySelector(platformConfig.scoreSelector);
          if (sEl) result.reactions = extractCountFromEl(sEl);
        }
        if (result.comments === 0) {
          var clEl = postEl.querySelector(platformConfig.commentLinkSelector);
          if (clEl) result.comments = extractCountFromEl(clEl);
        }
      }
      result.total = result.reactions + result.comments;
      return result;
    },

    meetsEngagementThreshold: function (engagement) {
      var t = this.config.engagementThresholds[platformName];
      if (!t) return true;
      if (platformName === 'x') return engagement.reactions >= (t.minLikes || 0) && engagement.comments >= (t.minRetweets || 0);
      if (platformName === 'reddit') return engagement.reactions >= (t.minUpvotes || 0) && engagement.comments >= (t.minComments || 0);
      return engagement.reactions >= (t.minReactions || 0) && engagement.comments >= (t.minComments || 0);
    },

    isPriorityTarget: function (postEl) {
      var targets = this.config.priorityTargets;
      if (!targets || targets.length === 0) return false;
      var authorName = '', authorHandle = '';
      if (platformName === 'linkedin' && platformConfig.authorSelector) {
        var aEl = postEl.querySelector(platformConfig.authorSelector);
        if (aEl) authorName = (aEl.innerText || aEl.textContent || '').trim().toLowerCase();
        if (platformConfig.authorLinkSelector) {
          var linkEl = postEl.querySelector(platformConfig.authorLinkSelector);
          if (linkEl) authorHandle = (linkEl.getAttribute('href') || '').toLowerCase();
        }
      } else if (platformName === 'x' && platformConfig.handleSelector) {
        var hEl = postEl.querySelector(platformConfig.handleSelector);
        if (hEl) { authorHandle = (hEl.getAttribute('href') || '').toLowerCase().replace(/^\//, ''); authorName = (hEl.textContent || '').trim().toLowerCase(); }
      } else if (platformName === 'reddit' && platformConfig.subredditSelector) {
        var subEl = postEl.querySelector(platformConfig.subredditSelector);
        if (subEl) authorHandle = (subEl.getAttribute('href') || '').toLowerCase();
      } else if (platformConfig.authorSelector) {
        var aEl2 = postEl.querySelector(platformConfig.authorSelector);
        if (aEl2) authorName = (aEl2.innerText || aEl2.textContent || '').trim().toLowerCase();
      }
      for (var i = 0; i < targets.length; i++) {
        var target = targets[i];
        var tPlatforms = target.platforms || (target.platform ? [target.platform] : ['linkedin', 'facebook', 'x', 'reddit']);
        if (tPlatforms.indexOf(platformName) === -1) continue;
        var tName = (target.name || '').toLowerCase();
        if (!tName) continue;
        if (authorName.indexOf(tName) !== -1) return true;
        if (authorHandle.indexOf(tName) !== -1) return true;
        if (authorHandle.indexOf(tName.replace('@', '')) !== -1) return true;
      }
      return false;
    },

    classifyAndComment: function (context, callback) {
      var self = this;
      var settings = savedSettings || {};
      var ps = (settings.platformSettings && settings.platformSettings[platformName]) || {};

      var tone = ps.tone || 'casual';
      var contextInfo = '';
      var allContexts = settings.contexts || [];
      var activeContextId = ps.activeContext || '';

      if (activeContextId) {
        for (var i = 0; i < allContexts.length; i++) {
          if (allContexts[i].id === activeContextId) { contextInfo = allContexts[i].body; break; }
        }
      }

      var autoInstructionPresets = ps.instructionPresets || [];
      var autoCustomInstructions = ps.customInstructions || '';

      var task = self.config.contentFilter === 'business' ? 'auto_classify_comment' : 'quick_reply';
      chrome.runtime.sendMessage({
        type: 'generate', data: {
          platform: platformName,
          task: task,
          tone: tone,
          context: context,
          personality: platformConfig.personality,
          contextInfo: contextInfo,
          mentionPages: self.config.autoMentionPages || [],
          instructionPresets: autoInstructionPresets,
          customInstructions: autoCustomInstructions
        }
      }, function (response) {
        if (chrome.runtime.lastError) { console.log('[SAIC-Auto] Error:', chrome.runtime.lastError.message); callback(null); return; }
        if (response && response.error) { console.log('[SAIC-Auto] API error:', response.error); callback(null); return; }
        if (response && response.text) {
          var text = response.text.trim();
          if (text.toUpperCase() === 'SKIP' || text.toUpperCase().indexOf('SKIP') === 0) { callback(null); return; }
          callback(text); return;
        }
        callback(null);
      });
    },

    submitCommentAuto: function (postEl, text, callback) {
      var self = this;
      if (self.state !== 'running') { callback(false); return; }
      self.clickCommentButton(postEl, function (replyField) {
        if (!replyField) { console.log('[SAIC-Auto] No reply field'); callback(false); return; }
        self.typeComment(replyField, text, function () {
          if (self.state !== 'running') { callback(false); return; }
          bgTimeout(function () {
            self.findAndClickSubmit(postEl, replyField, callback);
          }, jitter(randomBetween(500, 1500), 0.2));
        });
      });
    },

    showReviewOverlay: function (postEl, text, callback) {
      var self = this;
      var overlay = document.createElement('div');
      overlay.className = 'saic-review-overlay';
      overlay.innerHTML =
        '<div class="saic-review-card">' +
          '<div class="saic-review-title">AI Generated Comment</div>' +
          '<div class="saic-review-text">' + text.replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div>' +
          '<div class="saic-review-actions">' +
            '<button type="button" class="saic-review-post">Post Comment</button>' +
            '<button type="button" class="saic-review-skip">Skip</button>' +
          '</div>' +
        '</div>';
      overlay.querySelector('.saic-review-post').addEventListener('click', function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        self.clickCommentButton(postEl, function (replyField) {
          if (!replyField) { callback(false); return; }
          self.typeComment(replyField, text, function () { self.findAndClickSubmit(postEl, replyField, callback); });
        });
      });
      overlay.querySelector('.saic-review-skip').addEventListener('click', function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        callback(false);
      });
      document.body.appendChild(overlay);
    },

    addLog: function (msg) {
      this.logEntries.push(msg);
      if (this.logEntries.length > 20) this.logEntries.shift();
      this.updateLogUI();
    },

    updateLogUI: function () {
      if (!this.panelEl) return;
      var logEl = this.panelEl.querySelector('.saic-auto-log');
      if (!logEl) return;
      var html = '';
      var start = Math.max(0, this.logEntries.length - 5);
      for (var i = start; i < this.logEntries.length; i++) html += '<div class="saic-log-entry">' + this.logEntries[i] + '</div>';
      logEl.innerHTML = html;
      logEl.scrollTop = logEl.scrollHeight;
    },

    getPostFingerprint: function (el) {
      var postUrl = getPostLink(el, platformName);
      var text = (el.innerText || '').substring(0, 300).trim();
      var hash = 0;
      var combined = postUrl + '|' + text;
      for (var i = 0; i < combined.length; i++) hash = ((hash << 5) - hash + combined.charCodeAt(i)) | 0;
      return Math.abs(hash).toString(36) + '_' + el.tagName;
    },

    extractPostContext: function (postEl) {
      var text = extractText(postEl, 2000);
      var author = '';
      var authorInfo = getAuthorInfo(postEl, platformName);
      if (authorInfo.name) {
        author = authorInfo.name;
        if (authorInfo.handle && authorInfo.handle !== authorInfo.name) {
          author += ' (@' + authorInfo.handle + ')';
        }
      } else if (platformConfig.authorSelector) {
        var authorEls = postEl.querySelectorAll(platformConfig.authorSelector);
        if (authorEls.length > 0) author = (authorEls[0].innerText || authorEls[0].textContent || '').trim();
      }
      var siblings = postEl.parentElement ? postEl.parentElement.children : [];
      var comments = [];
      for (var i = 0; i < siblings.length && comments.length < 5; i++) {
        if (siblings[i] !== postEl) {
          for (var j = 0; j < platformConfig.postContainers.length; j++) {
            if (siblings[i].matches && siblings[i].matches(platformConfig.postContainers[j])) {
              var ct = extractText(siblings[i], 500);
              if (ct) comments.push(ct);
              break;
            }
          }
        }
      }
      return { postText: text, author: author, authorHandle: authorInfo.handle, authorProfileUrl: authorInfo.profileUrl, nearbyComments: comments, selectedText: '' };
    },

    clickCommentButton: function (postEl, callback) {
      var self = this;
      var selector = platformConfig.commentButtonSelector;
      if (!selector) { callback(null); return; }
      var isShreddit = postEl.tagName && postEl.tagName.toLowerCase() === 'shreddit-post';

      // Reddit shreddit-post: use dedicated Reddit handler
      if (isShreddit && platformName === 'reddit') {
        self.clickRedditCommentButton(postEl, callback);
        return;
      }
      // Search comment button — try light DOM, then shadow DOM, then parent
      var btn = isShreddit ? querySelectorDeep(postEl, selector) : postEl.querySelector(selector);
      if (!btn) {
        var parent = postEl.parentElement;
        if (parent) btn = parent.querySelector(selector);
      }
      if (!btn) {
        // Last resort: find nearest button within post visual bounds
        var postRect2 = postEl.getBoundingClientRect();
        var allBtns = document.querySelectorAll(selector);
        for (var bi = 0; bi < allBtns.length; bi++) {
          var br = allBtns[bi].getBoundingClientRect();
          if (br.top >= postRect2.top && br.bottom <= postRect2.bottom + 60) {
            btn = allBtns[bi];
            break;
          }
        }
      }
      if (!btn) { callback(null); return; }
      var postRect = postEl.getBoundingClientRect();
      humanMouseMove(btn, function () {
        btn.click();
        console.log('[SAIC-Auto] Clicked comment button');
        var attempts = 0, maxAttempts = 10;
        var findField = function () {
          attempts++;
          var field = null;
          var replySelector = platformConfig.replyFieldSelector;
          if (replySelector) {
            // Tier 1: Search scoped to the exact post element (with shadow DOM piercing for shreddit)
            var postCandidates = isShreddit ? querySelectorAllDeep(postEl, replySelector) : postEl.querySelectorAll(replySelector);
            for (var i = 0; i < postCandidates.length; i++) {
              var r = postCandidates[i].getBoundingClientRect();
              if (r.width > 0 && r.height > 0) { field = postCandidates[i]; break; }
            }
            // Tier 2: Check parent container but only fields that visually overlap with the post
            if (!field && postEl.parentElement) {
              var parentCandidates = postEl.parentElement.querySelectorAll(replySelector);
              for (var j = 0; j < parentCandidates.length; j++) {
                var r2 = parentCandidates[j].getBoundingClientRect();
                if (r2.width > 0 && r2.height > 0) {
                  if (r2.top >= postRect.top - 20 && r2.top <= postRect.bottom + 150) {
                    field = parentCandidates[j];
                    break;
                  }
                }
              }
            }
            // Tier 3: Global search with strict proximity — only fields directly below post
            if (!field) {
              var allCandidates = document.querySelectorAll(replySelector);
              var bestDist = Infinity;
              for (var k = 0; k < allCandidates.length; k++) {
                var r3 = allCandidates[k].getBoundingClientRect();
                if (r3.width > 0 && r3.height > 0) {
                  var dy = r3.top - postRect.bottom;
                  var dx = Math.abs(r3.left - postRect.left);
                  if (dy >= -30 && dy <= 200) {
                    var dist = Math.abs(dy) + dx * 0.5;
                    if (dist < bestDist) { bestDist = dist; field = allCandidates[k]; }
                  }
                }
              }
            }
          }
          if (field) callback(field);
          else if (attempts < maxAttempts) bgTimeout(findField, 200);
          else callback(null);
        };
        bgTimeout(findField, 300);
      });
    },

    typeComment: function (field, text, callback) {
      var self = this;
      field.focus();
      field.scrollIntoView({ block: 'center' });
      var mentionPages = self.config.autoMentionPages || [];
      var segments = self.splitByMentions(text, mentionPages);
      self.typeSegments(field, segments, 0, callback);
    },

    splitByMentions: function (text, mentionPages) {
      if (!mentionPages || mentionPages.length === 0) {
        return [{ text: text, isMention: false }];
      }
      var segments = [];
      var remaining = text;
      while (remaining.length > 0) {
        var bestIdx = -1, bestLen = 0;
        for (var p = 0; p < mentionPages.length; p++) {
          var page = mentionPages[p];
          var idx = remaining.indexOf(page);
          if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
            bestIdx = idx;
            bestLen = page.length;
          }
        }
        if (bestIdx === -1) {
          segments.push({ text: remaining, isMention: false });
          break;
        }
        if (bestIdx > 0) {
          segments.push({ text: remaining.substring(0, bestIdx), isMention: false });
        }
        segments.push({ text: remaining.substring(bestIdx, bestIdx + bestLen), isMention: true });
        remaining = remaining.substring(bestIdx + bestLen);
      }
      return segments;
    },

    typeSegments: function (field, segments, idx, callback) {
      var self = this;
      if (self.state !== 'running' || idx >= segments.length) { if (idx >= segments.length) callback(); return; }
      var seg = segments[idx];
      if (!seg.isMention) {
        self.typeChars(field, seg.text, function () {
          self.typeSegments(field, segments, idx + 1, callback);
        });
      } else {
        self.insertMention(field, seg.text, function () {
          self.typeSegments(field, segments, idx + 1, callback);
        });
      }
    },

    typeChars: function (field, text, callback) {
      var self = this;
      var chars = text.split('');
      var i = 0;
      var typeNext = function () {
        if (self.state !== 'running' || i >= chars.length) { if (i >= chars.length) callback(); return; }
        var char = chars[i];
        field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: char }));
        field.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: char }));
        if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
          var start = field.selectionStart;
          var val = field.value;
          field.value = val.substring(0, start) + char + val.substring(start);
          field.selectionStart = field.selectionEnd = start + 1;
        } else {
          document.execCommand('insertText', false, char);
        }
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: char }));
        i++;
        var delay = jitter(randomBetween(25, 75), 0.15);
        if (Math.random() < 0.08) delay += jitter(randomBetween(150, 350), 0.2);
        bgTimeout(typeNext, delay);
      };
      typeNext();
    },

    insertMention: function (field, pageName, callback) {
      var self = this;
      if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
        self.typeChars(field, pageName, callback);
        return;
      }
      var mentionText = '@' + pageName;
      self.typeChars(field, mentionText, function () {
        self.selectMentionResult(field, callback);
      });
    },

    selectMentionResult: function (field, callback) {
      var self = this;
      bgTimeout(function () {
        if (self.state !== 'running') { callback(); return; }
        var clicked = false;
        var selectors = [];
        if (platformName === 'linkedin') {
          selectors = [
            '.mentions-search-results li:first-child',
            '.mentions-search-results [role="option"]:first-child',
            '[class*="typeahead-v2"] li:first-child',
            '[class*="typeahead"] [role="option"]:first-child',
            '.entity-list li:first-child'
          ];
        } else if (platformName === 'facebook') {
          selectors = [
            '[role="listbox"] [role="option"]:first-child',
            '[class*="mentionsInput"] [role="option"]:first-child'
          ];
        } else if (platformName === 'x') {
          selectors = [
            '[class*="typeahead"] [role="option"]:first-child',
            '[role="listbox"] [role="option"]:first-child'
          ];
        } else if (platformName === 'reddit') {
          selectors = [
            '[class*="mention"] [role="option"]:first-child',
            '[role="listbox"] [role="option"]:first-child'
          ];
        }
        for (var i = 0; i < selectors.length; i++) {
          var el = document.querySelector(selectors[i]);
          if (el && el.offsetParent !== null) {
            humanMouseMove(el, function () {
              el.click();
              bgTimeout(callback, 600);
            });
            clicked = true;
            break;
          }
        }
        if (!clicked) {
          field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13 }));
          field.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: 'Enter', keyCode: 13 }));
          field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13 }));
          bgTimeout(callback, 600);
        }
      }, 2500);
    },

    findAndClickSubmit: function (postEl, replyField, callback) {
      var selector = platformConfig.submitButtonSelector;
      if (!selector) { callback(false); return; }
      var container = replyField.closest('[role="dialog"]') || replyField.closest('form') || replyField.closest('.Comment, .thing, [data-testid="post-container"]') || postEl;
      var btn = container.querySelector(selector);
      if (!btn) btn = postEl.querySelector(selector);
      if (!btn) {
        var allBtns = container.querySelectorAll('button');
        for (var i = 0; i < allBtns.length; i++) {
          var txt = (allBtns[i].textContent || '').toLowerCase().trim();
          if (txt === 'post' || txt === 'reply' || txt === 'comment' || txt === 'submit' || txt === 'send') { btn = allBtns[i]; break; }
        }
      }
      if (!btn) { console.log('[SAIC-Auto] No submit button'); callback(false); return; }
      var rect = btn.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) { console.log('[SAIC-Auto] Submit not visible'); callback(false); return; }
      humanMouseMove(btn, function () { btn.click(); console.log('[SAIC-Auto] Submitted'); callback(true); });
    },

    humanScroll: function (targetY, callback) {
      var self = this;
      var startY = window.scrollY;
      var distance = targetY - startY;
      if (Math.abs(distance) < 10) { if (callback) callback(); return; }
      var totalDuration = Math.max(500, Math.min(3000, Math.abs(distance) / (300 + Math.random() * 300) * 1000));
      var startTime = performance.now(), lastPauseAt = 0;
      function step() {
        if (self._abortScroll || self.state !== 'running') { if (callback) callback(); return; }
        var now = performance.now();
        var progress = Math.min((now - startTime) / totalDuration, 1);
        var eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        window.scrollTo(0, startY + distance * eased);
        if (progress - lastPauseAt > 0.15 + Math.random() * 0.2 && progress < 0.9) {
          lastPauseAt = progress;
          bgTimeout(step, 300 + Math.random() * 700);
          return;
        }
        if (progress < 1) bgTimeout(step, 16);
        else { if (callback) callback(); }
      }
      step();
    },

    scrollToPost: function (postEl, callback) {
      var rect = postEl.getBoundingClientRect();
      this.humanScroll(window.scrollY + rect.top - 100, callback);
    },

    quickAddTarget: function (name, platform, type) {
      if (!name || !name.trim()) return;
      this.config.priorityTargets.push({ name: name.trim(), platform: platform || platformName, type: type || 'person' });
      this.saveTargetsToSettings();
      this.addLog('Added target: ' + name.trim());
      this.updateTargetsUI();
    },

    removeTarget: function (index) {
      this.config.priorityTargets.splice(index, 1);
      this.saveTargetsToSettings();
      this.updateTargetsUI();
    },

    saveTargetsToSettings: function () {
      var settings = savedSettings || {};
      settings.priorityTargets = this.config.priorityTargets.slice();
      chrome.runtime.sendMessage({ type: 'saveSettings', data: { priorityTargets: settings.priorityTargets } });
    },

    updateTargetsUI: function () {
      if (!this.panelEl) return;
      var listEl = this.panelEl.querySelector('.saic-targets-list');
      if (!listEl) return;
      var html = '';
      var targets = this.config.priorityTargets;
      for (var i = 0; i < targets.length; i++) {
        html += '<span class="saic-target-chip">' + targets[i].name + '<span class="saic-target-remove" data-idx="' + i + '">&times;</span></span>';
      }
      listEl.innerHTML = html;
      var chips = listEl.querySelectorAll('.saic-target-remove');
      for (var j = 0; j < chips.length; j++) {
        chips[j].addEventListener('click', function (e) { AutomationEngine.removeTarget(parseInt(e.target.getAttribute('data-idx'), 10)); });
      }
      var badge = this.panelEl.querySelector('.saic-targets-count');
      if (badge) badge.textContent = targets.length;
    },

    recordComment: function (postEl, commentText, success) {
      var authorInfo = getAuthorInfo(postEl, platformName);
      var postLink = getPostLink(postEl, platformName);
      var entry = {
        timestamp: Date.now(),
        platform: platformName,
        postPreview: (postEl.innerText || '').substring(0, 120).trim().replace(/\n/g, ' '),
        postLink: postLink,
        comment: (commentText || '').substring(0, 200),
        success: !!success,
        authorName: authorInfo.name,
        authorHandle: authorInfo.handle,
        authorProfileUrl: authorInfo.profileUrl
      };
      this.commentHistory.unshift(entry);
      if (this.commentHistory.length > 100) this.commentHistory.length = 100;
      this.saveCommentHistory();
      this.updateHistoryUI();
    },

    saveCommentHistory: function () {
      try {
        chrome.storage.local.set({ saic_commentHistory: this.commentHistory.slice(0, 50) });
      } catch (e) { /* ignore */ }
    },

    loadCommentHistory: function () {
      var self = this;
      try {
        chrome.storage.local.get('saic_commentHistory', function (result) {
          if (result && result.saic_commentHistory) {
            self.commentHistory = result.saic_commentHistory;
            self.updateHistoryUI();
          }
        });
      } catch (e) { /* ignore */ }
    },

    updateHistoryUI: function () {
      if (!this.panelEl) return;
      var histEl = this.panelEl.querySelector('.saic-history-list');
      if (!histEl) return;
      var countBadge = this.panelEl.querySelector('.saic-history-count');
      if (countBadge) countBadge.textContent = this.commentHistory.length;
      var platformIcons = { linkedin: 'in', facebook: 'fb', x: 'X', reddit: 'r/' };
      var html = '';
      var entries = this.commentHistory;
      var start = Math.max(0, entries.length - 20);
      for (var i = start; i < entries.length; i++) {
        var e = entries[i];
        var time = new Date(e.timestamp);
        var timeStr = time.getHours() + ':' + String(time.getMinutes()).padStart(2, '0');
        var dateStr = (time.getMonth() + 1) + '/' + time.getDate();
        var icon = e.success ? '&#10003;' : '&#10007;';
        var iconClass = e.success ? 'saic-hist-ok' : 'saic-hist-fail';
        var pBadge = platformIcons[e.platform] || '?';
        var authorLine = '';
        if (e.authorName) {
          var displayName = e.authorName;
          if (e.authorHandle && e.authorHandle !== e.authorName) displayName += ' @' + e.authorHandle;
          if (e.authorProfileUrl) {
            authorLine = '<a class="saic-hist-author" href="' + e.authorProfileUrl.replace(/"/g, '&quot;') + '" target="_blank" title="View profile">' + displayName.replace(/</g, '&lt;') + '</a>';
          } else {
            authorLine = '<span class="saic-hist-author">' + displayName.replace(/</g, '&lt;') + '</span>';
          }
        }
        html += '<div class="saic-hist-entry" data-platform="' + (e.platform || '') + '">' +
          '<span class="saic-hist-icon ' + iconClass + '">' + icon + '</span>' +
          '<span class="saic-hist-platform saic-plat-' + (e.platform || '') + '">' + pBadge + '</span>' +
          '<div class="saic-hist-body">' +
            (authorLine ? '<div class="saic-hist-author-row">' + authorLine + '</div>' : '') +
            '<div class="saic-hist-preview">' + e.postPreview.replace(/</g, '&lt;').substring(0, 80) + '</div>' +
            '<div class="saic-hist-comment">' + e.comment.replace(/</g, '&lt;').substring(0, 80) + '</div>' +
            '<div class="saic-hist-meta">' +
              '<span class="saic-hist-time">' + dateStr + ' ' + timeStr + '</span>' +
              '<a class="saic-hist-link" href="' + e.postLink.replace(/"/g, '&quot;') + '" target="_blank" title="Open post to verify comment">View Post</a>' +
            '</div>' +
          '</div>' +
        '</div>';
      }
      if (!html) html = '<div class="saic-hist-empty">No comments yet</div>';
      histEl.innerHTML = html;
    },

    createPanel: function () {
      var self = this;
      if (self.panelEl) return;
      self.btnEl = document.createElement('button');
      self.btnEl.type = 'button';
      self.btnEl.className = 'saic-auto-btn';
      self.btnEl.title = 'AI Copilot Automation';
      self.btnEl.textContent = '▶';
      self.btnEl.addEventListener('click', function () { self.togglePanel(); });

      self.panelEl = document.createElement('div');
      self.panelEl.className = 'saic-auto-panel';
      self.panelEl.style.display = 'none';
      var pName = platformName || 'unknown';
      self.panelEl.innerHTML =
        '<div class="saic-auto-header"><span class="saic-auto-title">Auto Comment</span><button type="button" class="saic-auto-close" title="Close">&times;</button></div>' +
        '<div class="saic-auto-body">' +
          '<div class="saic-auto-status-row"><div class="saic-auto-status"><div class="saic-auto-dot"></div><span class="saic-auto-status-text">Idle</span></div>' +
            '<div class="saic-auto-mode-toggle"><span class="saic-mode-label">Auto</span><label class="saic-toggle"><input type="checkbox" class="saic-auto-cfg-mode" checked><span class="saic-toggle-slider"></span></label></div></div>' +
          '<div class="saic-auto-stats"><span class="saic-auto-stat">Comments: <strong>0</strong>/<span class="saic-auto-limit">∞</span></span><span class="saic-auto-stat">Skipped: <strong class="saic-auto-skipped">0</strong></span><span class="saic-auto-stat">Time: <strong class="saic-auto-elapsed">0:00</strong></span></div>' +
          '<div class="saic-auto-timer"></div>' +
          '<div class="saic-auto-controls"><button type="button" class="saic-auto-toggle-btn saic-auto-start">Start</button><button type="button" class="saic-auto-toggle-btn saic-auto-pause" style="display:none;">Pause</button><button type="button" class="saic-auto-gear" title="Settings">⚙</button></div>' +
          '<div class="saic-auto-log"></div>' +
	          '<div class="saic-history-toggle"><button type="button" class="saic-history-btn">History <span class="saic-history-count">0</span></button></div>' +
	          '<div class="saic-history-list"></div>' +
          '<div class="saic-auto-config">' +
            '<div class="saic-auto-field"><label>Interval: <span class="saic-interval-val">60</span>s</label><input type="range" class="saic-auto-cfg-interval" min="30" max="300" value="60"></div>' +
            '<div class="saic-auto-field"><label>Stop after (0=off)</label><input type="number" class="saic-auto-cfg-limit" min="0" max="500" value="0"></div>' +
            '<div class="saic-auto-field"><label>Content filter</label><select class="saic-auto-cfg-filter"><option value="business">Business / Startup only</option><option value="all">All posts</option></select></div>' +
            '<div class="saic-auto-field"><label>Quick add target <span class="saic-targets-count">0</span></label><div class="saic-target-quick-add"><input type="text" class="saic-target-input" placeholder="e.g. Bill Gates, @naval, r/startups"><button type="button" class="saic-target-add-btn">+</button></div></div>' +
            '<div class="saic-targets-list"></div>' +
            '<div class="saic-auto-field"><label>Auto-mention pages</label><div class="saic-target-quick-add"><input type="text" class="saic-mention-input" placeholder="e.g. Periscale (comma-separated)"><button type="button" class="saic-mention-save-btn">Save</button></div></div>' +
            '<div class="saic-auto-platform">Platform: ' + pName + '</div>' +
          '</div>' +
        '</div>';

      document.body.appendChild(self.btnEl);
      document.body.appendChild(self.panelEl);

      self.panelEl.querySelector('.saic-auto-close').addEventListener('click', function () { self.panelEl.style.display = 'none'; });

      var startBtn = self.panelEl.querySelector('.saic-auto-start');
      var pauseBtn = self.panelEl.querySelector('.saic-auto-pause');
      startBtn.addEventListener('click', function () {
        if (self.state === 'idle' || self.state === 'stopped') {
          self.config.interval = Math.max(30, Math.min(300, parseInt(self.panelEl.querySelector('.saic-auto-cfg-interval').value, 10) || 60));
          self.config.stopLimit = Math.max(0, parseInt(self.panelEl.querySelector('.saic-auto-cfg-limit').value, 10) || 0);
          self.config.autoSubmit = self.panelEl.querySelector('.saic-auto-cfg-mode').checked;
          self.config.contentFilter = self.panelEl.querySelector('.saic-auto-cfg-filter').value;
          self.start();
        } else if (self.state === 'paused') { self.resume(); }
      });
      pauseBtn.addEventListener('click', function () {
        if (self.state === 'running') self.pause();
        else if (self.state === 'paused') self.resume();
      });
      self.panelEl.querySelector('.saic-auto-gear').addEventListener('click', function () {
        self.panelEl.querySelector('.saic-auto-config').classList.toggle('open');
      });
      self.panelEl.querySelector('.saic-auto-cfg-interval').addEventListener('input', function () {
        self.panelEl.querySelector('.saic-interval-val').textContent = this.value;
      });
      self.panelEl.querySelector('.saic-target-add-btn').addEventListener('click', function () {
        var input = self.panelEl.querySelector('.saic-target-input');
        var name = input.value.trim();
        if (!name) return;
        var type = 'person';
        if (name.indexOf('r/') === 0) type = 'subreddit';
        else if (name.indexOf('/groups/') !== -1) type = 'group';
        self.quickAddTarget(name, platformName, type);
        input.value = '';
      });
      self.panelEl.querySelector('.saic-target-input').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') self.panelEl.querySelector('.saic-target-add-btn').click();
      });

      self.updateTargetsUI();
      // Pre-fill mention pages input
      var mentionInput = self.panelEl.querySelector('.saic-mention-input');
      if (mentionInput && self.config.autoMentionPages) {
        mentionInput.value = self.config.autoMentionPages.join(', ');
      }
      self.panelEl.querySelector('.saic-mention-save-btn').addEventListener('click', function () {
        var raw = (self.panelEl.querySelector('.saic-mention-input').value || '').trim();
        var pages = raw.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
        self.config.autoMentionPages = pages;
        var psUpdate = {};
        psUpdate[platformName] = { mentionPages: pages };
        chrome.runtime.sendMessage({ type: 'saveSettings', data: { platformSettings: psUpdate } });
        self.addLog('Mention pages updated: ' + (pages.length > 0 ? pages.join(', ') : 'none'));
      });
      self.loadCommentHistory();
      self.panelEl.querySelector('.saic-history-btn').addEventListener('click', function () {
        self.panelEl.querySelector('.saic-history-list').classList.toggle('open');
      });
      self.makePanelDraggable();
    },

    togglePanel: function () {
      if (!this.panelEl) return;
      this.panelEl.style.display = this.panelEl.style.display === 'none' ? 'block' : 'none';
    },

    makePanelDraggable: function () {
      var self = this;
      var header = self.panelEl.querySelector('.saic-auto-header');
      if (!header) return;
      var isDragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
      header.addEventListener('mousedown', function (e) {
        if (e.target.closest('.saic-auto-close')) return;
        isDragging = true; startX = e.clientX; startY = e.clientY;
        var rect = self.panelEl.getBoundingClientRect();
        startLeft = rect.left; startTop = rect.top;
        self.panelEl.style.left = startLeft + 'px'; self.panelEl.style.top = startTop + 'px';
        self.panelEl.style.right = 'auto'; self.panelEl.style.bottom = 'auto';
        header.style.cursor = 'grabbing'; e.preventDefault();
      });
      document.addEventListener('mousemove', function (e) {
        if (!isDragging) return;
        self.panelEl.style.left = (startLeft + e.clientX - startX) + 'px';
        self.panelEl.style.top = (startTop + e.clientY - startY) + 'px';
      });
      document.addEventListener('mouseup', function () { if (isDragging) { isDragging = false; header.style.cursor = 'grab'; } });
    },

    updateUI: function () {
      var self = this;
      if (!self.panelEl) return;
      var dot = self.panelEl.querySelector('.saic-auto-dot');
      var statusText = self.panelEl.querySelector('.saic-auto-status-text');
      var startBtn = self.panelEl.querySelector('.saic-auto-start');
      var pauseBtn = self.panelEl.querySelector('.saic-auto-pause');
      var timerEl = self.panelEl.querySelector('.saic-auto-timer');
      dot.className = 'saic-auto-dot';
      switch (self.state) {
        case 'idle':
          dot.classList.add('stopped'); statusText.textContent = 'Idle';
          startBtn.textContent = 'Start'; startBtn.className = 'saic-auto-toggle-btn saic-auto-start'; startBtn.style.display = '';
          pauseBtn.style.display = 'none'; timerEl.textContent = '';
          self.btnEl.className = 'saic-auto-btn'; self.btnEl.textContent = '▶'; break;
        case 'running':
          dot.classList.add('running'); statusText.textContent = 'Running';
          startBtn.style.display = 'none'; pauseBtn.textContent = 'Pause'; pauseBtn.className = 'saic-auto-toggle-btn saic-auto-pause'; pauseBtn.style.display = '';
          self.btnEl.className = 'saic-auto-btn running'; self.btnEl.textContent = '⏸'; break;
        case 'paused':
          dot.classList.add('paused'); statusText.textContent = 'Paused';
          startBtn.textContent = 'Resume'; startBtn.className = 'saic-auto-toggle-btn saic-auto-start'; startBtn.style.display = '';
          pauseBtn.style.display = 'none';
          self.btnEl.className = 'saic-auto-btn'; self.btnEl.textContent = '▶'; break;
        case 'stopped':
          dot.classList.add('stopped'); statusText.textContent = 'Stopped (' + self.stats.commentsMade + ')';
          startBtn.textContent = 'Restart'; startBtn.className = 'saic-auto-toggle-btn saic-auto-start'; startBtn.style.display = '';
          pauseBtn.style.display = 'none'; timerEl.textContent = '';
          self.btnEl.className = 'saic-auto-btn'; self.btnEl.textContent = '▶'; break;
      }
      var cs = self.panelEl.querySelector('.saic-auto-stat strong');
      if (cs) cs.textContent = self.stats.commentsMade;
      var le = self.panelEl.querySelector('.saic-auto-limit');
      if (le) le.textContent = self.config.stopLimit || '∞';
      var ee = self.panelEl.querySelector('.saic-auto-elapsed');
      if (ee) ee.textContent = self.formatElapsed();
      var se = self.panelEl.querySelector('.saic-auto-skipped');
      if (se) se.textContent = self.stats.postsSkipped;
      var ci = self.panelEl.querySelector('.saic-auto-cfg-interval');
      var iv = self.panelEl.querySelector('.saic-interval-val');
      if (ci) ci.value = self.config.interval; if (iv) iv.textContent = self.config.interval;
      var cl = self.panelEl.querySelector('.saic-auto-cfg-limit');
      if (cl) cl.value = self.config.stopLimit;
      var cf = self.panelEl.querySelector('.saic-auto-cfg-filter');
      if (cf) cf.value = self.config.contentFilter;
      var cm = self.panelEl.querySelector('.saic-auto-cfg-mode');
      if (cm) cm.checked = self.config.autoSubmit;
    },

    formatElapsed: function () {
      if (!this.stats.startTime) return '0:00';
      var ms = Date.now() - this.stats.startTime;
      var secs = Math.floor(ms / 1000), mins = Math.floor(secs / 60), hrs = Math.floor(mins / 60);
      if (hrs > 0) return hrs + ':' + String(mins % 60).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
      return mins + ':' + String(secs % 60).padStart(2, '0');
    },

    init: function () {
      if (!platformConfig || !platformConfig.postSelector) return;
      this.loadConfig();
      this.createPanel();
      console.log('[SAIC-Auto] Panel created for ' + platformName + ' - ' + this.config.priorityTargets.length + ' targets');
    }
  };

  // ══════════════════════════════════════════════════
  // ── Reddit Automation Engine ──
  // ══════════════════════════════════════════════════

  var RedditAutoEngine = {
    commentTimestamps: [],
    blockedSubreddits: new Set(),
    recentOpenings: [],
    mentionCount: 0,
    totalComments: 0,
    coffeeBreakAfter: 0,
    coffeeBreakCounter: 0,
    config: {},

    loadConfig: function () {
      var settings = savedSettings || {};
      var ps = (settings.platformSettings && settings.platformSettings.reddit) || {};
      this.config = {
        targetSubreddits: (ps.targetSubreddits || []).map(function (s) { return s.toLowerCase().replace(/^r\//, ''); }),
        blacklistSubreddits: (ps.blacklistSubreddits || []).map(function (s) { return s.toLowerCase().replace(/^r\//, ''); }),
        autoDetectGenre: ps.autoDetectGenre !== false,
        businessName: ps.businessName || '',
        businessDescription: ps.businessDescription || '',
        mentionFrequency: ps.mentionFrequency !== undefined ? ps.mentionFrequency : 15,
        maxCommentsPerHour: ps.maxCommentsPerHour || 3,
        skipNewPostsMinutes: ps.skipNewPostsMinutes || 60,
        skipBotRestrictedSubs: ps.skipBotRestrictedSubs !== false,
        interval: Math.max(60, Math.min(300, ps.interval || 90)),
        stopLimit: ps.stopLimit || 0,
        autoSubmit: ps.autoSubmit !== false
      };
      this.coffeeBreakAfter = 3 + Math.floor(Math.random() * 3);
    },

    extractSubreddit: function (postEl) {
      var shTag = postEl.tagName ? postEl.tagName.toLowerCase() : '';
      if (shTag === 'shreddit-post') {
        var subAttr = (postEl.getAttribute('subreddit') || '').toLowerCase();
        if (subAttr) return subAttr;
      }
      if (!platformConfig || !platformConfig.subredditSelector) return '';
      var subEl = postEl.querySelector(platformConfig.subredditSelector);
      if (!subEl) {
        var parent = postEl.parentElement;
        if (parent) subEl = parent.querySelector(platformConfig.subredditSelector);
      }
      if (!subEl) return '';
      var href = (subEl.getAttribute('href') || '').toLowerCase();
      var match = href.match(/\/r\/([a-zA-Z0-9_]+)/);
      return match ? match[1].toLowerCase() : '';
    },

    isSubredditTarget: function (subreddit) {
      if (!subreddit) return false;
      if (this.config.blacklistSubreddits.indexOf(subreddit) !== -1) return false;
      if (this.blockedSubreddits.has(subreddit)) return false;
      if (this.config.targetSubreddits.length > 0 && this.config.targetSubreddits.indexOf(subreddit) !== -1) return true;
      if (this.config.targetSubreddits.length === 0 && this.config.autoDetectGenre) return true;
      if (this.config.autoDetectGenre) return true;
      return false;
    },

    checkSubredditCooldown: function (subreddit) {
      var now = Date.now();
      var oneHourAgo = now - 3600000;
      var subCount = 0;
      for (var i = 0; i < this.commentTimestamps.length; i++) {
        if (this.commentTimestamps[i].subreddit === subreddit && this.commentTimestamps[i].timestamp > oneHourAgo) {
          subCount++;
        }
      }
      if (subCount >= 2) return false;
      if (this.commentTimestamps.length > 0) {
        var lastSub = this.commentTimestamps[this.commentTimestamps.length - 1].subreddit;
        if (lastSub === subreddit) {
          if (this.config.targetSubreddits.length <= 1) {
            var lastTime = this.commentTimestamps[this.commentTimestamps.length - 1].timestamp;
            if (now - lastTime < 300000) return false;
          } else {
            return false;
          }
        }
      }
      return true;
    },

    checkRateLimit: function () {
      var now = Date.now();
      var oneHourAgo = now - 3600000;
      this.commentTimestamps = this.commentTimestamps.filter(function (t) { return t.timestamp > oneHourAgo; });
      return this.commentTimestamps.length < this.config.maxCommentsPerHour;
    },

    checkSubredditRules: function (subreddit, callback) {
      var self = this;
      if (!self.config.skipBotRestrictedSubs) { callback(true); return; }
      if (self.blockedSubreddits.has(subreddit)) { callback(false); return; }
      var BOT_KEYWORDS = ['no bots', 'no automated', 'no ai', 'no self-promo', 'human only', 'manual posts only', 'no automated posting', 'bot-free'];
      var sidebarEl = document.querySelector('.sidebar, .side, [data-testid="sidebar"], .reddit-sidebar, shreddit-sidebar, [slot="sidebar"]');
      if (!sidebarEl) sidebarEl = document.querySelector('.rules-page, [data-testid="rules"]');
      if (sidebarEl) {
        var rulesText = (sidebarEl.innerText || '').toLowerCase();
        for (var i = 0; i < BOT_KEYWORDS.length; i++) {
          if (rulesText.indexOf(BOT_KEYWORDS[i]) !== -1) {
            self.blockedSubreddits.add(subreddit);
            AutomationEngine.addLog('Blocked subreddit: r/' + subreddit + ' (bot restriction detected)');
            callback(false);
            return;
          }
        }
      }
      callback(true);
    },

    shouldMentionBusiness: function () {
      if (!this.config.businessName) return false;
      if (this.totalComments === 0) return false;
      var mentionRate = (this.mentionCount / this.totalComments) * 100;
      if (mentionRate >= this.config.mentionFrequency) return false;
      return true;
    },

    getRedditDelay: function () {
      var base = this.config.interval * 1000;
      var multiplier = 0.7 + Math.random() * 0.9;
      var delay = base * multiplier;
      delay = jitter(delay, 0.2);
      this.coffeeBreakCounter++;
      if (this.coffeeBreakCounter >= this.coffeeBreakAfter) {
        var breakMs = jitter(randomBetween(180000, 480000), 0.2);
        AutomationEngine.addLog('Coffee break: ' + Math.round(breakMs / 1000) + 's');
        delay += breakMs;
        this.coffeeBreakCounter = 0;
        this.coffeeBreakAfter = 3 + Math.floor(Math.random() * 3);
      }
      return delay;
    },

    redditTypeChars: function (field, text, callback) {
      var self = this;
      var words = text.split(/(\s+)/);
      var wordIdx = 0;
      var charIdx = 0;
      var currentWord = '';

      function typeNextChar() {
        if (AutomationEngine.state !== 'running') { callback(); return; }
        if (wordIdx >= words.length) { callback(); return; }
        if (charIdx === 0) currentWord = words[wordIdx];
        if (charIdx >= currentWord.length) {
          wordIdx++;
          charIdx = 0;
          bgTimeout(typeNextChar, jitter(randomBetween(30, 80), 0.2));
          return;
        }
        var char = currentWord[charIdx];
        var delay = jitter(randomBetween(50, 180), 0.3);
        if (Math.random() < 0.15 && charIdx > 0 && charIdx < currentWord.length - 1) {
          delay += jitter(randomBetween(200, 500), 0.2);
        }

        // Typo simulation: ~3% per word
        if (charIdx > 0 && charIdx < currentWord.length - 1 && Math.random() < 0.03) {
          var wrongChar = String.fromCharCode(char.charCodeAt(0) + (Math.random() < 0.5 ? 1 : -1));
          field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: wrongChar }));
          if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
            var start = field.selectionStart;
            var val = field.value;
            field.value = val.substring(0, start) + wrongChar + val.substring(start);
            field.selectionStart = field.selectionEnd = start + 1;
          } else {
            document.execCommand('insertText', false, wrongChar);
          }
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: wrongChar }));
          bgTimeout(function () {
            field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Backspace' }));
            if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
              var pos = field.selectionStart - 1;
              field.value = field.value.substring(0, pos) + field.value.substring(pos + 1);
              field.selectionStart = field.selectionEnd = pos;
            } else {
              document.execCommand('delete');
            }
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Backspace' }));
            bgTimeout(function () {
              field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: char }));
              if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
                var s = field.selectionStart;
                var v = field.value;
                field.value = v.substring(0, s) + char + v.substring(s);
                field.selectionStart = field.selectionEnd = s + 1;
              } else {
                document.execCommand('insertText', false, char);
              }
              field.dispatchEvent(new Event('input', { bubbles: true }));
              field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: char }));
              charIdx++;
              bgTimeout(typeNextChar, delay);
            }, jitter(randomBetween(200, 400), 0.2));
          }, jitter(randomBetween(200, 400), 0.2));
          return;
        }

        field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: char }));
        if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
          var s = field.selectionStart;
          var v = field.value;
          field.value = v.substring(0, s) + char + v.substring(s);
          field.selectionStart = field.selectionEnd = s + 1;
        } else {
          document.execCommand('insertText', false, char);
        }
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: char }));
        charIdx++;
        if (char === '.' || char === '!' || char === '?') delay += jitter(randomBetween(400, 800), 0.2);
        bgTimeout(typeNextChar, delay);
      }
      typeNextChar();
    },

    redditClick: function (el, callback) {
      var rect = el.getBoundingClientRect();
      var cx = rect.left + rect.width * (0.3 + Math.random() * 0.4) + randomBetween(-3, 3);
      var cy = rect.top + rect.height * (0.3 + Math.random() * 0.4) + randomBetween(-3, 3);
      document.dispatchEvent(new MouseEvent('mouseover', { clientX: cx, clientY: cy, bubbles: true }));
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: cx, clientY: cy, bubbles: true }));
      bgTimeout(function () {
        el.dispatchEvent(new MouseEvent('mousedown', { clientX: cx, clientY: cy, bubbles: true }));
        bgTimeout(function () {
          el.dispatchEvent(new MouseEvent('mouseup', { clientX: cx, clientY: cy, bubbles: true }));
          el.dispatchEvent(new MouseEvent('click', { clientX: cx, clientY: cy, bubbles: true }));
          if (callback) bgTimeout(callback, jitter(randomBetween(100, 300), 0.2));
        }, jitter(randomBetween(40, 100), 0.2));
      }, jitter(randomBetween(50, 150), 0.2));
    },

    isDuplicateOpening: function (commentText) {
      if (!commentText) return false;
      var firstWords = commentText.trim().split(/\s+/).slice(0, 5).join(' ').toLowerCase();
      for (var i = 0; i < this.recentOpenings.length; i++) {
        if (this.recentOpenings[i] === firstWords) return true;
      }
      return false;
    },

    recordOpening: function (commentText) {
      if (!commentText) return;
      var firstWords = commentText.trim().split(/\s+/).slice(0, 5).join(' ').toLowerCase();
      this.recentOpenings.push(firstWords);
      if (this.recentOpenings.length > 10) this.recentOpenings.shift();
    },

    processRedditPost: function (postEl, reason) {
      var self = this;
      if (AutomationEngine.state !== 'running') return;
      var postId = AutomationEngine.getPostFingerprint(postEl);
      AutomationEngine.processedPosts.add(postId);
      AutomationEngine.stats.postsScanned++;
      AutomationEngine.addLog(reason || 'Processing Reddit post');

      var subreddit = self.extractSubreddit(postEl);
      if (!self.isSubredditTarget(subreddit)) {
        AutomationEngine.stats.postsSkipped++;
        AutomationEngine.addLog('Skipped: subreddit r/' + (subreddit || 'unknown') + ' not targeted');
        AutomationEngine.scheduleNextCycle(jitter(3000, 0.3));
        return;
      }
      if (!self.checkSubredditCooldown(subreddit)) {
        AutomationEngine.stats.postsSkipped++;
        AutomationEngine.addLog('Skipped: r/' + subreddit + ' cooldown');
        AutomationEngine.scheduleNextCycle(jitter(5000, 0.3));
        return;
      }
      if (!self.checkRateLimit()) {
        AutomationEngine.addLog('Rate limit reached: ' + self.config.maxCommentsPerHour + '/hr');
        var waitMs = self.commentTimestamps.length > 0 ? 3600000 - (Date.now() - self.commentTimestamps[0].timestamp) + 5000 : 60000;
        AutomationEngine.scheduleNextCycle(Math.max(waitMs, 60000));
        return;
      }
      self.checkSubredditRules(subreddit, function (allowed) {
        if (!allowed) {
          AutomationEngine.stats.postsSkipped++;
          AutomationEngine.scheduleNextCycle(jitter(5000, 0.3));
          return;
        }
        AutomationEngine.scrollToPost(postEl, function () {
          if (AutomationEngine.state !== 'running') return;
          var readDelay = jitter(randomBetween(5000, 15000), 0.15);
          AutomationEngine.updateCountdown(readDelay, 'Reading...');
          bgTimeout(function () {
            if (AutomationEngine.state !== 'running') return;
            if (!postEl.isConnected) { AutomationEngine.addLog('Post removed from DOM'); AutomationEngine.scheduleNextCycle(jitter(3000, 0.3)); return; }
            var context = AutomationEngine.extractPostContext(postEl);
            context.subreddit = subreddit;

            var mentionMode = null;
            if (self.shouldMentionBusiness()) {
              mentionMode = { active: true, businessName: self.config.businessName, businessDescription: self.config.businessDescription };
            }

            var settings = savedSettings || {};
            var ps = (settings.platformSettings && settings.platformSettings.reddit) || {};
            var autoInstructionPresets = ps.instructionPresets || [];
            var autoCustomInstructions = ps.customInstructions || '';

            chrome.runtime.sendMessage({
              type: 'generate', data: {
                platform: 'reddit',
                task: 'reddit_auto_comment',
                tone: ps.tone || 'casual',
                context: context,
                personality: 'You are a real Reddit user. You are helpful, genuine, and community-aware. You match the subreddit culture. You write in natural conversational English like you are chatting with a peer. You never sound like marketing, a bot, or AI. You avoid corporate language entirely.',
                contextInfo: '',
                mentionPages: [],
                instructionPresets: autoInstructionPresets,
                customInstructions: autoCustomInstructions,
                mentionMode: mentionMode
              }
            }, function (response) {
              if (chrome.runtime.lastError) { console.log('[SAIC-Reddit] Error:', chrome.runtime.lastError.message); AutomationEngine.scheduleNextCycle(jitter(5000, 0.3)); return; }
              var text = (response && response.text) ? response.text.trim() : '';
              if (!text || text === 'SKIP') {
                AutomationEngine.stats.postsSkipped++;
                AutomationEngine.addLog(text === 'SKIP' ? 'Skipped: not relevant or controversial' : 'Skipped: no response');
                AutomationEngine.scheduleNextCycle(jitter(5000, 0.3));
                return;
              }
              if (self.isDuplicateOpening(text)) {
                AutomationEngine.addLog('Skipped: duplicate opening');
                AutomationEngine.scheduleNextCycle(jitter(5000, 0.3));
                return;
              }
              self.recordOpening(text);
              if (self.config.autoSubmit) {
                self.submitRedditComment(postEl, text, subreddit, function (success) {
                  self.afterRedditComment(success, text, postEl, subreddit);
                });
              } else {
                AutomationEngine.showReviewOverlay(postEl, text, function (approved) {
                  if (approved) self.afterRedditComment(true, text, postEl, subreddit);
                  else { AutomationEngine.addLog('Skipped by user'); AutomationEngine.scheduleNextCycle(jitter(5000, 0.3)); }
                });
              }
            });
          }, readDelay);
        });
      });
    },

    getRedditPageType: function () {
      var path = window.location.pathname;
      if (/\/comments\//.test(path)) return 'comments';
      if (/\/submit/.test(path)) return 'submit';
      return 'feed';
    },

    clickRedditCommentButton: function (postEl, callback) {
      var self = this;
      var isShreddit = postEl.tagName && postEl.tagName.toLowerCase() === 'shreddit-post';
      var btn = null;

      // Strategy 1: Shadow DOM search for comment button/link
      if (isShreddit) {
        var commentSelectors = platformConfig.redditCommentButtonSelectors || [];
        for (var i = 0; i < commentSelectors.length; i++) {
          if (postEl.shadowRoot) {
            btn = postEl.shadowRoot.querySelector(commentSelectors[i]);
          }
          if (!btn) btn = querySelectorDeepRecursive(postEl, commentSelectors[i], 3);
          if (btn) break;
        }
      }

      // Strategy 2: Light DOM search in parent/sibling area
      if (!btn && postEl.parentElement) {
        var commentSelectors2 = platformConfig.redditCommentButtonSelectors || [];
        for (var j = 0; j < commentSelectors2.length; j++) {
          btn = postEl.parentElement.querySelector(commentSelectors2[j]);
          if (btn) break;
        }
        // Also try finding any comment/reply text button near the post
        if (!btn) {
          var nearBtns = postEl.parentElement.querySelectorAll('button, a[role="button"], a');
          var postRect = postEl.getBoundingClientRect();
          for (var k = 0; k < nearBtns.length; k++) {
            var nr = nearBtns[k].getBoundingClientRect();
            if (nr.top >= postRect.top && nr.bottom <= postRect.bottom + 60) {
              var ntxt = (nearBtns[k].textContent || '').toLowerCase().trim();
              if (ntxt.indexOf('comment') !== -1 || ntxt.match(/\d+\s*comment/)) {
                btn = nearBtns[k];
                break;
              }
            }
          }
        }
      }

      // Strategy 3: For feed pages, find the comments link on the post
      if (!btn) {
        var hrefAttr = '';
        if (isShreddit) {
          hrefAttr = postEl.getAttribute('permalink') || postEl.getAttribute('href') || '';
          if (hrefAttr && !/^https?:\/\//.test(hrefAttr) && hrefAttr.charAt(0) === '/') {
            hrefAttr = 'https://www.reddit.com' + hrefAttr;
          }
        }
        if (!hrefAttr) {
          var links = isShreddit ? querySelectorAllDeepRecursive(postEl, 'a[href*="/comments/"]', 3) : postEl.querySelectorAll('a[href*="/comments/"]');
          if (links.length > 0) hrefAttr = links[0].getAttribute('href') || '';
        }
        if (hrefAttr && hrefAttr.indexOf('/comments/') !== -1) {
          AutomationEngine.addLog('Navigating to comments page: ' + hrefAttr.substring(0, 60));
          window.location.href = hrefAttr;
          return;
        }
      }

      if (!btn) { console.log('[SAIC-Reddit] No comment button found'); callback(null); return; }

      humanMouseMove(btn, function () {
        self.redditClick(btn, function () {
          console.log('[SAIC-Reddit] Clicked comment button');
          var attempts = 0, maxAttempts = 15;
          var findField = function () {
            attempts++;
            var field = self.findRedditReplyField(postEl);
            if (field) callback(field);
            else if (attempts < maxAttempts) bgTimeout(findField, 300);
            else { console.log('[SAIC-Reddit] No reply field after clicking comment'); callback(null); }
          };
          bgTimeout(findField, 500);
        });
      });
    },

    findRedditReplyField: function (postEl) {
      var isShreddit = postEl.tagName && postEl.tagName.toLowerCase() === 'shreddit-post';
      var field = null;
      var postRect = postEl.getBoundingClientRect();

      // Strategy 1: Shadow DOM recursive search
      if (isShreddit) {
        var shadowSelectors = ['textarea', '[contenteditable="true"]', '[role="textbox"]', 'textarea[name="text"]'];
        for (var i = 0; i < shadowSelectors.length; i++) {
          field = querySelectorDeepRecursive(postEl, shadowSelectors[i], 4);
          if (field && field.getBoundingClientRect().width > 0) return field;
          field = null;
        }
      }

      // Strategy 2: Search parent/sibling area by proximity
      var searchRoot = postEl.parentElement;
      if (searchRoot && searchRoot.parentElement) searchRoot = searchRoot.parentElement;
      if (searchRoot) {
        var replySelector = 'textarea, [contenteditable="true"], [role="textbox"]';
        var candidates = searchRoot.querySelectorAll(replySelector);
        var bestDist = Infinity;
        for (var j = 0; j < candidates.length; j++) {
          var r = candidates[j].getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            var dy = r.top - postRect.bottom;
            if (dy >= -50 && dy <= 400) {
              var dist = Math.abs(dy) + Math.abs(r.left - postRect.left) * 0.3;
              if (dist < bestDist) { bestDist = dist; field = candidates[j]; }
            }
          }
        }
        if (field) return field;
      }

      // Strategy 3: Global search closest to post
      var allFields = document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]');
      var bestDist2 = Infinity;
      for (var k = 0; k < allFields.length; k++) {
        var r2 = allFields[k].getBoundingClientRect();
        if (r2.width > 0 && r2.height > 0) {
          var dy2 = r2.top - postRect.bottom;
          if (dy2 >= -50 && dy2 <= 500) {
            var dist2 = Math.abs(dy2) + Math.abs(r2.left - postRect.left) * 0.3;
            if (dist2 < bestDist2) { bestDist2 = dist2; field = allFields[k]; }
          }
        }
      }
      return field;
    },

    submitRedditComment: function (postEl, text, subreddit, callback) {
      var self = this;
      if (AutomationEngine.state !== 'running') { callback(false); return; }

      // For feed pages, navigate to comments first
      var pageType = self.getRedditPageType();
      if (pageType === 'feed') {
        AutomationEngine.clickCommentButton(postEl, function (replyField) {
          if (!replyField) {
            // clickRedditCommentButton may have navigated — that's fine
            callback(false);
            return;
          }
          self.typeAndSubmit(postEl, replyField, text, callback);
        });
        return;
      }

      // Comments page: use Reddit-specific button finding
      var isShreddit = postEl.tagName && postEl.tagName.toLowerCase() === 'shreddit-post';

      // Try to find existing reply field first (comments page may already have one)
      var existingField = self.findRedditReplyField(postEl);
      if (existingField) {
        self.typeAndSubmit(postEl, existingField, text, callback);
        return;
      }

      // Click comment button to open field
      if (isShreddit) {
        self.clickRedditCommentButton(postEl, function (replyField) {
          if (!replyField) { console.log('[SAIC-Reddit] No reply field'); callback(false); return; }
          self.typeAndSubmit(postEl, replyField, text, callback);
        });
      } else {
        AutomationEngine.clickCommentButton(postEl, function (replyField) {
          if (!replyField) { console.log('[SAIC-Reddit] No reply field'); callback(false); return; }
          self.typeAndSubmit(postEl, replyField, text, callback);
        });
      }
    },

    typeAndSubmit: function (postEl, replyField, text, callback) {
      var self = this;
      var isShreddit = postEl.tagName && postEl.tagName.toLowerCase() === 'shreddit-post';
      self.redditTypeChars(replyField, text, function () {
        if (AutomationEngine.state !== 'running') { callback(false); return; }
        bgTimeout(function () {
          var btn = null;
          var submitSelectors = platformConfig.redditSubmitButtonSelectors || ['button[type="submit"]'];
          var container = replyField.closest('[role="dialog"]') || replyField.closest('form') || replyField.closest('.Comment, .thing, [data-testid="post-container"], shreddit-post') || postEl;

          // Try each submit selector
          for (var si = 0; si < submitSelectors.length; si++) {
            if (isShreddit) {
              btn = querySelectorDeepRecursive(container, submitSelectors[si], 4);
              if (!btn) btn = querySelectorDeepRecursive(postEl, submitSelectors[si], 4);
            }
            if (!btn) btn = container.querySelector(submitSelectors[si]);
            if (!btn) btn = postEl.querySelector(submitSelectors[si]);
            if (btn && btn.getBoundingClientRect().width > 0) break;
            btn = null;
          }

          // Fall back to text-based search
          if (!btn) {
            var allBtns = isShreddit ? querySelectorAllDeepRecursive(container, 'button', 4) : container.querySelectorAll('button');
            for (var i = 0; i < allBtns.length; i++) {
              var txt = (allBtns[i].textContent || '').toLowerCase().trim();
              if (txt === 'comment' || txt === 'reply' || txt === 'post' || txt === 'submit' || txt === 'send') { btn = allBtns[i]; break; }
            }
          }

          if (!btn) { console.log('[SAIC-Reddit] No submit button'); callback(false); return; }
          var rect = btn.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) { console.log('[SAIC-Reddit] Submit not visible'); callback(false); return; }
          humanMouseMove(btn, function () {
            self.redditClick(btn, function () {
              console.log('[SAIC-Reddit] Submitted');
              callback(true);
            });
          });
        }, jitter(randomBetween(800, 2000), 0.2));
      });
    },

    afterRedditComment: function (success, text, postEl, subreddit) {
      var self = this;
      if (success) {
        AutomationEngine.stats.commentsMade++;
        self.totalComments++;
        self.commentTimestamps.push({ timestamp: Date.now(), subreddit: subreddit });
        if (self.config.businessName && text.toLowerCase().indexOf(self.config.businessName.toLowerCase()) !== -1) {
          self.mentionCount++;
        }
        AutomationEngine.addLog('Commented in r/' + subreddit + ': "' + (text || '').substring(0, 50) + '..."');
      } else {
        AutomationEngine.addLog('Failed to submit');
      }
      if (postEl) AutomationEngine.recordComment(postEl, text, success);
      AutomationEngine.updateUI();
      var delay = self.getRedditDelay();
      AutomationEngine.scheduleNextCycle(delay);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
