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
  // Walk up from clicked element to find the nearest editable field container
  function findEditableField(el) {
    if (!platformConfig) return null;
    var current = el;
    var depth = 0;
    while (current && current !== document.body && depth < 12) {
      if (current.matches) {
        // Check platform-specific selectors
        for (var i = 0; i < platformConfig.editableFields.length; i++) {
          if (current.matches(platformConfig.editableFields[i])) return current;
        }
        // Generic contenteditable fallback
        if (current.getAttribute && current.getAttribute('contenteditable') === 'true') return current;
      }
      // Textareas and text inputs
      if (current.tagName === 'TEXTAREA') return current;
      if (current.tagName === 'INPUT' && (current.type === 'text' || current.type === 'search')) return current;
      current = current.parentElement;
      depth++;
    }
    return null;
  }

  function isEditableField(el) {
    return findEditableField(el) !== null;
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

    function handleChipClick(actionId) {
      handleAction(actionId, toneSelect.value, field, resultCard, insertBtn, regenBtn, resultActions);
    }

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

    // Tone selector
    var toneSelect = document.createElement('select');
    toneSelect.className = 'saic-tone-select';
    var defaultTone = (savedSettings && savedSettings.defaultTone) || 'casual';
    ['casual', 'funny', 'informative'].forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      if (t === defaultTone) opt.selected = true;
      toneSelect.appendChild(opt);
    });
    toolbar.appendChild(toneSelect);

    popover.appendChild(toolbar);
    popover.appendChild(resultCard);
    popover.appendChild(resultActions);

    // Position near the field
    var rect = field.getBoundingClientRect();
    var left = Math.max(8, rect.left);
    var top = rect.bottom + 8;

    // Keep within viewport
    if (left + 384 > window.innerWidth) {
      left = Math.max(8, window.innerWidth - 392);
    }
    if (top + 200 > window.innerHeight) {
      top = Math.max(8, rect.top - 200);
    }

    popover.style.left = left + 'px';
    popover.style.top = top + 'px';

    document.body.appendChild(popover);
    currentPopoverEl = popover;

    // Make draggable via header
    makeDraggable(popover, header);
  }

  // ── Action handler ──
  function handleAction(task, tone, field, resultCard, insertBtn, regenBtn, resultActions) {
    var context = extractContext(field);

    resultCard.style.display = 'block';
    resultCard.textContent = 'Generating...';
    resultCard.className = 'saic-result-card saic-loading';
    resultActions.style.display = 'none';

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
          handleAction(lastGeneratedAction, lastGeneratedTone, field, resultCard, newInsertBtn, newRegenBtn, resultActions);
        });
      }
    });
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
    if (field) {
      activeField = field;
    }
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
    chrome.storage.local.get('socialAiCopilot_settings', function (result) {
      if (chrome.runtime.lastError) {
        // Storage read failed (e.g. invalidated context) — keep defaults
        return;
      }
      var settings = result.socialAiCopilot_settings || {};
      var platforms = settings.platforms || {};
      if (platforms[platformName] === false) {
        // Platform disabled — remove listener
        document.removeEventListener('dblclick', handleDblClick, true);
        return;
      }
      savedSettings = settings;
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
