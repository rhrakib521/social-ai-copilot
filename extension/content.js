// content.js
// Main content script entry point for Social AI Copilot.
// Detects platform, watches for editable fields via MutationObserver,
// creates triggers, manages popover lifecycle, and communicates with background.js.

(function () {
  'use strict';

  // ── State ──
  var platformConfig = null;
  var platformName = null;
  var activeField = null;
  var popoverController = null;
  var observer = null;
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
        '.comments-comment-texteditor[contenteditable="true"]',
        '[data-placeholder*="post"]',
        '[aria-label*="Post"]',
        '[aria-label*="comment"]',
        '[aria-label*="message"]'
      ],
      postContainers: [
        '.feed-shared-update-v2',
        '.comments-comments-list__comment-item',
        '.msg-s-message-listevent'
      ],
      authorSelector: '.update-components-actor__title span[dir="ltr"], .comments-post-meta__actor span[dir="ltr"]',
      personality: 'You are writing for LinkedIn. The tone should be professional and thought-leadership oriented. Use industry-relevant language. Keep content polished and suitable for a business network.'
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
      personality: 'You are writing for Facebook. The tone should be friendly, conversational, and engaging. Content should feel natural and encourage interaction.'
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
      personality: 'You are writing for X (Twitter). Be concise, punchy, and impactful. Respect the character-limited culture even when writing longer posts.'
    },
    reddit: {
      editableFields: [
        '.public-DraftEditor-content[contenteditable="true"]',
        'textarea[name="text"]',
        'textarea#comment-textarea',
        '[contenteditable="true"]',
        '.md textarea'
      ],
      postContainers: [
        '.thing.link',
        '.thing.comment',
        '[data-testid="post-container"]',
        '.Comment'
      ],
      authorSelector: '.author, a[data-testid="post_author_link"], [data-testid="comment_author_link"]',
      personality: 'You are writing for Reddit. Be authentic, knowledgeable, and community-aware. Match the subreddit culture. Avoid overly marketing language. Use proper formatting with Markdown.'
    }
  };

  // ── Context extraction ──
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
    var text = (el.innerText || el.textContent || '').trim();
    if (text.length > maxLength) text = text.substring(0, maxLength) + '...';
    return text;
  }

  function extractContext(activeEl) {
    var result = { postText: '', author: '', nearbyComments: [], selectedText: '' };
    if (!activeEl || !platformConfig) return result;

    result.selectedText = getSelectedText();

    var postEl = findNearestAncestor(activeEl, platformConfig.postContainers, 20);
    if (postEl) {
      result.postText = extractText(postEl);
      if (platformConfig.authorSelector) {
        var authorEls = postEl.querySelectorAll(platformConfig.authorSelector);
        if (authorEls.length > 0) {
          result.author = (authorEls[0].innerText || authorEls[0].textContent || '').trim();
        }
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
  var currentPopoverEl = null;
  var currentTriggerWrapper = null;

  function removeExistingTrigger() {
    if (currentTriggerWrapper && currentTriggerWrapper.parentNode) {
      currentTriggerWrapper.parentNode.removeChild(currentTriggerWrapper);
    }
    currentTriggerWrapper = null;
  }

  function hidePopover() {
    if (currentPopoverEl && currentPopoverEl.parentNode) {
      currentPopoverEl.parentNode.removeChild(currentPopoverEl);
    }
    currentPopoverEl = null;
    popoverController = null;
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
      openPopover(trigger, field);
    });

    return { trigger: trigger, wrapper: wrapper, field: field };
  }

  function openPopover(triggerEl, field) {
    hidePopover();

    var popover = document.createElement('div');
    popover.className = 'saic-popover';

    // Header
    var header = document.createElement('div');
    header.className = 'saic-popover-header';

    var title = document.createElement('span');
    title.className = 'saic-popover-title';
    title.textContent = 'AI Copilot';
    header.appendChild(title);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'saic-popover-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', function () { hidePopover(); });
    header.appendChild(closeBtn);
    popover.appendChild(header);

    // Actions
    var actions = document.createElement('div');
    actions.className = 'saic-popover-actions';
    var actionTypes = [
      { id: 'reply', label: 'Reply' },
      { id: 'comment', label: 'Comment' },
      { id: 'post', label: 'New Post' },
      { id: 'rewrite', label: 'Rewrite' },
      { id: 'expand', label: 'Expand' },
      { id: 'summarize', label: 'Summarize' }
    ];
    actionTypes.forEach(function (action) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'saic-action-btn';
      btn.textContent = action.label;
      btn.setAttribute('data-action', action.id);
      btn.addEventListener('click', function () {
        handleAction(action.id, toneSelect.value, field, resultArea, insertBtn, regenBtn);
      });
      actions.appendChild(btn);
    });
    popover.appendChild(actions);

    // Tone selector
    var toneRow = document.createElement('div');
    toneRow.className = 'saic-tone-row';

    var toneLabel = document.createElement('span');
    toneLabel.className = 'saic-tone-label';
    toneLabel.textContent = 'Tone:';
    toneRow.appendChild(toneLabel);

    var toneSelect = document.createElement('select');
    toneSelect.className = 'saic-tone-select';
    ['professional', 'casual', 'witty', 'direct'].forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      toneSelect.appendChild(opt);
    });
    toneRow.appendChild(toneSelect);
    popover.appendChild(toneRow);

    // Result area
    var resultArea = document.createElement('div');
    resultArea.className = 'saic-result-area';
    resultArea.style.display = 'none';
    popover.appendChild(resultArea);

    // Insert button
    var insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.className = 'saic-insert-btn';
    insertBtn.textContent = 'Insert';
    insertBtn.style.display = 'none';
    popover.appendChild(insertBtn);

    // Regenerate button
    var regenBtn = document.createElement('button');
    regenBtn.type = 'button';
    regenBtn.className = 'saic-regen-btn';
    regenBtn.textContent = 'Regenerate';
    regenBtn.style.display = 'none';
    popover.appendChild(regenBtn);

    // Position
    var triggerRect = triggerEl.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.left = Math.max(8, triggerRect.left - 180) + 'px';
    popover.style.top = (triggerRect.bottom + 8) + 'px';
    popover.style.zIndex = '999999';

    document.body.appendChild(popover);
    currentPopoverEl = popover;
  }

  // ── Action handler ──
  function handleAction(task, tone, field, resultArea, insertBtn, regenBtn) {
    var context = extractContext(field);

    resultArea.style.display = 'block';
    resultArea.textContent = 'Generating...';
    resultArea.className = 'saic-result-area saic-loading';
    insertBtn.style.display = 'none';
    regenBtn.style.display = 'none';

    lastGeneratedAction = task;
    lastGeneratedTone = tone;

    // Send to background.js
    chrome.runtime.sendMessage({
      type: 'generate',
      data: {
        platform: platformName,
        task: task,
        tone: tone,
        context: context,
        personality: platformConfig.personality
      }
    }, function (response) {
      if (chrome.runtime.lastError) {
        resultArea.textContent = 'Error: ' + chrome.runtime.lastError.message;
        resultArea.className = 'saic-result-area saic-error';
        return;
      }
      if (response && response.error) {
        resultArea.textContent = 'Error: ' + response.error;
        resultArea.className = 'saic-result-area saic-error';
        return;
      }
      if (response && response.text) {
        lastGeneratedText = response.text;
        resultArea.textContent = response.text;
        resultArea.className = 'saic-result-area';
        insertBtn.style.display = 'block';
        regenBtn.style.display = 'block';

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
          handleAction(lastGeneratedAction, lastGeneratedTone, field, resultArea, newInsertBtn, newRegenBtn);
        });
      }
    });
  }

  // ── MutationObserver ──
  function isEditableField(el) {
    if (!el || !el.matches) return false;
    if (!platformConfig) return false;
    for (var i = 0; i < platformConfig.editableFields.length; i++) {
      if (el.matches(platformConfig.editableFields[i])) return true;
    }
    return false;
  }

  function setupObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        if (!added) continue;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (isEditableField(node)) {
            createTriggerForField(node);
          }
          if (node.querySelectorAll) {
            var selector = platformConfig.editableFields.join(', ');
            var fields = node.querySelectorAll(selector);
            for (var k = 0; k < fields.length; k++) {
              createTriggerForField(fields[k]);
            }
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Focus listener ──
  function setupFocusListener() {
    document.addEventListener('focusin', function (e) {
      var target = e.target;
      if (isEditableField(target)) {
        activeField = target;
        if (!currentTriggerWrapper || currentTriggerWrapper.__saic_field !== target) {
          var trig = createTriggerForField(target);
          if (trig) trig.wrapper.__saic_field = target;
        }
      }
    });
  }

  // ── Keyboard shortcut handler (from background.js command) ──
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.type === 'triggerShortcut') {
      if (activeField) {
        var existingTrigger = currentTriggerWrapper ? currentTriggerWrapper.querySelector('.saic-trigger') : null;
        if (existingTrigger) {
          openPopover(existingTrigger, activeField);
        } else {
          var trig = createTriggerForField(activeField);
          if (trig && trig.trigger) {
            openPopover(trig.trigger, activeField);
          }
        }
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'No active editable field found.' });
      }
    }
  });

  // ── Click outside to close ──
  document.addEventListener('click', function (e) {
    if (currentPopoverEl && !currentPopoverEl.contains(e.target)) {
      var isTrigger = e.target.classList && e.target.classList.contains('saic-trigger');
      if (!isTrigger) hidePopover();
    }
  });

  // ── Initialization ──
  function init() {
    platformName = detectPlatform(window.location.href);
    if (!platformName) return;

    platformConfig = PLATFORMS[platformName];
    if (!platformConfig) return;

    chrome.storage.local.get('socialAiCopilot_settings', function (result) {
      var settings = result.socialAiCopilot_settings || {};
      var platforms = settings.platforms || {};
      if (platforms[platformName] === false) return;

      setupFocusListener();
      setupObserver();

      // Initial scan
      var selector = platformConfig.editableFields.join(', ');
      var existingFields = document.querySelectorAll(selector);
      for (var i = 0; i < existingFields.length; i++) {
        createTriggerForField(existingFields[i]);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
