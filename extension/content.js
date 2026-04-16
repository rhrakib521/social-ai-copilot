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
      personality: 'You are writing for LinkedIn. The tone should be professional and thought-leadership oriented. Use industry-relevant language. Keep content polished and suitable for a business network.',
      postSelector: '.feed-shared-update-v2, .feed-shared-celebration-v2',
      commentButtonSelector: 'button[aria-label*="Comment"], button[aria-label*="comment"]',
      replyFieldSelector: '.ql-editor[contenteditable="true"]',
      submitButtonSelector: 'button[type="submit"], button.comments-comment-box__submit-button'
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
      submitButtonSelector: '[aria-label*="Comment"][role="button"]:not([aria-label*="Comment for"]), [aria-label*="Post"][role="button"]'
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
      submitButtonSelector: '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]'
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
      personality: 'You are writing for Reddit. Be authentic, knowledgeable, and community-aware. Match the subreddit culture. Avoid overly marketing language. Use proper formatting with Markdown.',
      postSelector: '[data-testid="post-container"], .Post, .thing.link',
      commentButtonSelector: 'button[onclick*="comment"], [data-testid="comment-button"]',
      replyFieldSelector: 'textarea[name="text"], textarea#comment-textarea, .public-DraftEditor-content[contenteditable="true"]',
      submitButtonSelector: 'button[type="submit"]'
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
    var defaultTone = (savedSettings && savedSettings.defaultTone) || 'casual';
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
    var defaultCtxId = '';
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
        opt.textContent = ctx.name + (ctx.isDefault ? ' \u2605' : '');
        if (ctx.isDefault) {
          defaultCtxId = ctx.id;
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
        if (ctx.isDefault) pill.textContent += ' \u2605';
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
      handleAction(actionId, toneSelect.value, contextSelect ? contextSelect.value : '', field, resultCard, insertBtn, regenBtn, resultActions);
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

      // Build context with user's topic
      var postContext = {
        postText: userTopic,
        author: '',
        nearbyComments: [],
        selectedText: '',
        extraContexts: selectedCtxTexts
      };

      chrome.runtime.sendMessage({
        type: 'generate',
        data: {
          platform: platformName,
          task: 'post',
          tone: toneSelect.value,
          context: postContext,
          personality: platformConfig.personality,
          contextInfo: selectedCtxTexts.join('\n')
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
  function handleAction(task, tone, contextId, field, resultCard, insertBtn, regenBtn, resultActions) {
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

    // Send to background.js
    chrome.runtime.sendMessage({
      type: 'generate',
      data: {
        platform: platformName,
        task: task,
        tone: tone,
        context: context,
        personality: platformConfig.personality,
        contextInfo: contextInfo
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
          handleAction(lastGeneratedAction, lastGeneratedTone, contextId, field, resultCard, newInsertBtn, newRegenBtn, resultActions);
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
  // ── Automation Engine ──
  // ══════════════════════════════════════════════════

  var AutomationEngine = {
    state: 'idle', // idle | running | paused | stopped
    config: {
      interval: 60,
      stopLimit: 0
    },
    stats: {
      commentsMade: 0,
      startTime: null,
      postsScanned: 0
    },
    processedPosts: new Set(),
    _confirmed: false,
    reviewMode: true,
    panelEl: null,
    btnEl: null,
    timerInterval: null,
    nextActionTimeout: null,
    countdownInterval: null,
    nextActionTime: null,
    _abortScroll: false,

    // ── Settings ──
    loadConfig: function () {
      var settings = savedSettings || {};
      this.config.interval = Math.max(120, Math.min(300, settings.autoInterval || 60));
      this.config.stopLimit = Math.max(0, settings.autoStopLimit || 0);
    },

    // ── Core Loop ──
    start: function () {
      if (!this._confirmed) {
        var msg = 'Automated commenting may violate platform Terms of Service and could result in account suspension or permanent ban.\n\nAI-generated comments may need to be disclosed under FTC and EU regulations.\n\nContinue?';
        if (!confirm(msg)) return;
        this._confirmed = true;
      }
      this.loadConfig();
      this.state = 'running';
      this.stats.commentsMade = 0;
      this.stats.startTime = Date.now();
      this.stats.postsScanned = 0;
      this.processedPosts = new Set();
      this._abortScroll = false;
      console.log('[SAIC-Auto] Started — interval:', this.config.interval + 's, stop limit:', this.config.stopLimit || 'unlimited');
      this.updateUI();
      this.runCycle();
    },

    stop: function (reason) {
      this.state = 'stopped';
      this._abortScroll = true;
      clearTimeout(this.nextActionTimeout);
      clearInterval(this.countdownInterval);
      this.nextActionTimeout = null;
      this.countdownInterval = null;
      this.nextActionTime = null;
      console.log('[SAIC-Auto] Stopped' + (reason ? ' — ' + reason : ''));
      this.updateUI();
    },

    pause: function () {
      if (this.state !== 'running') return;
      this.state = 'paused';
      this._abortScroll = true;
      clearTimeout(this.nextActionTimeout);
      clearInterval(this.countdownInterval);
      this.nextActionTimeout = null;
      this.countdownInterval = null;
      this.nextActionTime = null;
      console.log('[SAIC-Auto] Paused at ' + this.stats.commentsMade + ' comments');
      this.updateUI();
    },

    resume: function () {
      if (this.state !== 'paused') return;
      this.state = 'running';
      this._abortScroll = false;
      console.log('[SAIC-Auto] Resumed');
      this.updateUI();
      this.runCycle();
    },

    runCycle: function () {
      var self = this;
      if (self.state !== 'running') return;

      // Check stop limit
      if (self.config.stopLimit > 0 && self.stats.commentsMade >= self.config.stopLimit) {
        self.stop('limit reached (' + self.config.stopLimit + ' comments)');
        return;
      }

      // Find next post
      var post = self.findNextPost();
      if (!post) {
        console.log('[SAIC-Auto] No uncommented post found, scrolling...');
        self.humanScroll(window.scrollY + window.innerHeight * (1 + Math.random() * 2), function () {
          if (self.state !== 'running') return;
          setTimeout(function () {
            post = self.findNextPost();
            if (!post) {
              console.log('[SAIC-Auto] No posts found after scroll, retrying in 10s...');
              self.scheduleNextCycle(10000);
              return;
            }
            self.processPost(post);
          }, 1500 + Math.random() * 1500);
        });
        return;
      }

      self.processPost(post);
    },

    processPost: function (post) {
      var self = this;
      if (self.state !== 'running') return;

      var postId = self.getPostFingerprint(post);
      self.processedPosts.add(postId);
      self.stats.postsScanned++;

      self.scrollToPost(post, function () {
        if (self.state !== 'running') return;

        var readDelay = 3000 + Math.random() * 5000;
        console.log('[SAIC-Auto] Reading post for ' + Math.round(readDelay / 1000) + 's...');
        self.updateCountdown(readDelay, 'Reading...');

        setTimeout(function () {
          if (self.state !== 'running') return;

          if (!post.isConnected) {
            console.log('[SAIC-Auto] Post element was removed from DOM, skipping');
            self.scheduleNextCycle(3000);
            return;
          }

          var context = self.extractPostContext(post);

          self.generateComment(context, function (text) {
            if (self.state !== 'running') return;
            if (!text) {
              console.log('[SAIC-Auto] Comment generation failed, skipping post');
              self.scheduleNextCycle(5000);
              return;
            }

            self.typeAndSubmit(post, text, function (success) {
              if (success) {
                self.stats.commentsMade++;
                console.log('[SAIC-Auto] Comment #' + self.stats.commentsMade + ' posted: "' + text.substring(0, 60) + '..."');
              } else {
                console.log('[SAIC-Auto] Failed to submit comment, moving on');
              }
              self.updateUI();

              var extraPause = (self.stats.commentsMade % (5 + Math.floor(Math.random() * 4)) === 0)
                ? 5000 + Math.random() * 10000
                : 0;
              self.scheduleNextCycle(self.config.interval * 1000 + extraPause);
            });
          });
        }, readDelay);
      });
    },

    scheduleNextCycle: function (delayMs) {
      var self = this;
      if (self.state !== 'running') return;

      console.log('[SAIC-Auto] Next in ' + Math.round(delayMs / 1000) + 's');
      self.updateCountdown(delayMs, 'Next in');

      self.nextActionTimeout = setTimeout(function () {
        if (self.state === 'running') {
          self.runCycle();
        }
      }, delayMs);
    },

    updateCountdown: function (totalMs, prefix) {
      var self = this;
      clearInterval(self.countdownInterval);
      if (!self.panelEl) return;

      var timerEl = self.panelEl.querySelector('.saic-auto-timer');
      if (!timerEl) return;

      var remaining = totalMs;
      timerEl.textContent = prefix + ' ' + Math.ceil(remaining / 1000) + 's';

      self.countdownInterval = setInterval(function () {
        remaining -= 1000;
        if (remaining <= 0) {
          clearInterval(self.countdownInterval);
          timerEl.textContent = 'Working...';
          return;
        }
        timerEl.textContent = prefix + ' ' + Math.ceil(remaining / 1000) + 's';
      }, 1000);
    },

    // ── Post Detection ──
    findNextPost: function () {
      if (!platformConfig || !platformConfig.postSelector) return null;
      var posts = document.querySelectorAll(platformConfig.postSelector);
      for (var i = 0; i < posts.length; i++) {
        var fp = this.getPostFingerprint(posts[i]);
        if (!this.processedPosts.has(fp) && !this.isAlreadyCommented(posts[i])) {
          return posts[i];
        }
      }
      return null;
    },

    getPostFingerprint: function (el) {
      var text = (el.innerText || '').substring(0, 300).trim();
      var hash = 0;
      for (var i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
      }
      return Math.abs(hash).toString(36) + '_' + el.tagName;
    },

    isAlreadyCommented: function (postEl) {
      // Rely on processedPosts set for dedup — DOM-based user detection is unreliable
      return false;
    },

    extractPostContext: function (postEl) {
      var text = extractText(postEl, 2000);
      var author = '';
      if (platformConfig.authorSelector) {
        var authorEls = postEl.querySelectorAll(platformConfig.authorSelector);
        if (authorEls.length > 0) {
          author = (authorEls[0].innerText || authorEls[0].textContent || '').trim();
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

      return {
        postText: text,
        author: author,
        nearbyComments: comments,
        selectedText: ''
      };
    },

    // ── AI Generation ──
    generateComment: function (context, callback) {
      var self = this;
      var tone = (savedSettings && savedSettings.defaultTone) || 'casual';

      var contextInfo = '';
      var allContexts = (savedSettings && savedSettings.contexts) || [];
      var defaultCtx = allContexts.find(function (c) { return c.isDefault; });
      if (defaultCtx) contextInfo = defaultCtx.body;

      chrome.runtime.sendMessage({
        type: 'generate',
        data: {
          platform: platformName,
          task: 'quick_reply',
          tone: tone,
          context: context,
          personality: platformConfig.personality,
          contextInfo: contextInfo
        }
      }, function (response) {
        if (chrome.runtime.lastError) {
          console.log('[SAIC-Auto] Generate error:', chrome.runtime.lastError.message);
          callback(null);
          return;
        }
        if (response && response.error) {
          console.log('[SAIC-Auto] Generate API error:', response.error);
          callback(null);
          return;
        }
        if (response && response.text) {
          callback(response.text);
          return;
        }
        callback(null);
      });
    },

    // ── Comment Submission ──
    typeAndSubmit: function (postEl, text, callback) {
      var self = this;
      if (self.state !== 'running') { callback(false); return; }

      if (self.reviewMode) {
        // Review mode: show comment in a dialog for user approval
        var approved = confirm('AI Comment (click OK to post, Cancel to skip):\n\n' + text);
        if (!approved) {
          console.log('[SAIC-Auto] Comment skipped by user (review mode)');
          callback(false);
          return;
        }
      }

      self.clickCommentButton(postEl, function (replyField) {
        if (!replyField) {
          console.log('[SAIC-Auto] Could not find reply field after clicking comment button');
          callback(false);
          return;
        }

        self.typeComment(replyField, text, function () {
          if (self.state !== 'running') { callback(false); return; }

          setTimeout(function () {
            self.clickSubmitButton(postEl, replyField, function (success) {
              callback(success);
            });
          }, 500 + Math.random() * 500);
        });
      });
    },

    clickCommentButton: function (postEl, callback) {
      var selector = platformConfig.commentButtonSelector;
      if (!selector) { callback(null); return; }

      var btn = postEl.querySelector(selector);
      if (!btn) {
        var parent = postEl.parentElement;
        if (parent) btn = parent.querySelector(selector);
      }
      if (!btn) { callback(null); return; }

      btn.click();
      console.log('[SAIC-Auto] Clicked comment button');

      var attempts = 0;
      var maxAttempts = 10;
      var findField = function () {
        attempts++;
        var field = null;
        var replySelector = platformConfig.replyFieldSelector;
        if (replySelector) {
          var candidates = document.querySelectorAll(replySelector);
          for (var i = 0; i < candidates.length; i++) {
            var rect = candidates[i].getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              field = candidates[i];
              break;
            }
          }
        }
        if (field) {
          callback(field);
        } else if (attempts < maxAttempts) {
          setTimeout(findField, 200);
        } else {
          callback(null);
        }
      };
      setTimeout(findField, 300);
    },

    typeComment: function (field, text, callback) {
      var self = this;
      field.focus();
      field.scrollIntoView({ block: 'center' });

      var chars = text.split('');
      var i = 0;

      var typeNext = function () {
        if (self.state !== 'running' || i >= chars.length) {
          if (i >= chars.length) callback();
          return;
        }

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

        var delay = 30 + Math.random() * 50;
        if (Math.random() < 0.1) delay += 100 + Math.random() * 100;

        setTimeout(typeNext, delay);
      };

      typeNext();
    },

    clickSubmitButton: function (postEl, replyField, callback) {
      var selector = platformConfig.submitButtonSelector;
      if (!selector) { callback(false); return; }

      var container = replyField.closest('[role="dialog"]') || replyField.closest('form') || postEl;
      var btn = container.querySelector(selector);
      if (!btn) {
        btn = postEl.querySelector(selector);
      }
      if (!btn) {
        var allBtns = container.querySelectorAll('button');
        for (var i = 0; i < allBtns.length; i++) {
          var txt = (allBtns[i].textContent || '').toLowerCase().trim();
          if (txt === 'post' || txt === 'reply' || txt === 'comment' || txt === 'submit' || txt === 'send') {
            btn = allBtns[i];
            break;
          }
        }
      }

      if (!btn) {
        console.log('[SAIC-Auto] No submit button found');
        callback(false);
        return;
      }

      var rect = btn.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        console.log('[SAIC-Auto] Submit button not visible');
        callback(false);
        return;
      }

      btn.click();
      console.log('[SAIC-Auto] Clicked submit button');
      callback(true);
    },

    // ── Human-Like Scrolling ──
    humanScroll: function (targetY, callback) {
      var self = this;
      var startY = window.scrollY;
      var distance = targetY - startY;
      if (Math.abs(distance) < 10) { if (callback) callback(); return; }

      var direction = distance > 0 ? 1 : -1;
      var totalDuration = Math.abs(distance) / (300 + Math.random() * 300) * 1000;
      totalDuration = Math.max(500, Math.min(3000, totalDuration));

      var startTime = null;
      var lastPauseAt = 0;

      function step(timestamp) {
        if (self._abortScroll || self.state !== 'running') {
          if (callback) callback();
          return;
        }

        if (!startTime) startTime = timestamp;
        var elapsed = timestamp - startTime;
        var progress = Math.min(elapsed / totalDuration, 1);

        var eased = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        var currentY = startY + distance * eased;
        window.scrollTo(0, currentY);

        if (progress - lastPauseAt > 0.15 + Math.random() * 0.2 && progress < 0.9) {
          lastPauseAt = progress;
          var pauseMs = 300 + Math.random() * 700;
          setTimeout(function () {
            requestAnimationFrame(step);
          }, pauseMs);
          return;
        }

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          if (callback) callback();
        }
      }

      requestAnimationFrame(step);
    },

    scrollToPost: function (postEl, callback) {
      var rect = postEl.getBoundingClientRect();
      var targetY = window.scrollY + rect.top - 100;
      this.humanScroll(targetY, callback);
    },

    // ── Floating Panel UI ──
    createPanel: function () {
      var self = this;
      if (self.panelEl) return;

      self.btnEl = document.createElement('button');
      self.btnEl.type = 'button';
      self.btnEl.className = 'saic-auto-btn';
      self.btnEl.title = 'AI Copilot Automation';
      self.btnEl.textContent = '\u25B6';
      self.btnEl.addEventListener('click', function () {
        self.togglePanel();
      });

      self.panelEl = document.createElement('div');
      self.panelEl.className = 'saic-auto-panel';
      self.panelEl.style.display = 'none';

      self.panelEl.innerHTML =
        '<div class="saic-auto-header">' +
          '<span class="saic-auto-title">Auto Comment</span>' +
          '<button type="button" class="saic-auto-close" title="Close panel">&times;</button>' +
        '</div>' +
        '<div class="saic-auto-body">' +
          '<div class="saic-auto-status">' +
            '<div class="saic-auto-dot"></div>' +
            '<span class="saic-auto-status-text">Idle</span>' +
          '</div>' +
          '<div class="saic-auto-stats">' +
            '<span class="saic-auto-stat">Comments: <strong>0</strong>/<span class="saic-auto-limit">\u221E</span></span>' +
            '<span class="saic-auto-stat">Time: <strong class="saic-auto-elapsed">0:00</strong></span>' +
          '</div>' +
          '<div class="saic-auto-timer"></div>' +
          '<div class="saic-auto-controls">' +
            '<button type="button" class="saic-auto-toggle-btn saic-auto-start">Start</button>' +
            '<button type="button" class="saic-auto-toggle-btn saic-auto-pause" style="display:none;">Pause</button>' +
            '<button type="button" class="saic-auto-gear" title="Settings">\u2699</button>' +
          '</div>' +
          '<div class="saic-auto-config">' +
            '<div class="saic-auto-field">' +
              '<label>Interval (sec)</label>' +
              '<input type="number" class="saic-auto-cfg-interval" min="120" max="300" value="60">' +
            '</div>' +
            '<div class="saic-auto-field">' +
              '<label>Stop after (0=off)</label>' +
              '<input type="number" class="saic-auto-cfg-limit" min="0" max="500" value="0">' +
            '</div>' +
            '<div class="saic-auto-field">' +
              '<label>Review before submit</label>' +
              '<input type="checkbox" class="saic-auto-cfg-review" checked style="width:auto;">' +
            '</div>' +
            '<div class="saic-auto-platform">Platform: ' + (platformName || 'unknown') + '</div>' +
          '</div>' +
        '</div>';

      document.body.appendChild(self.btnEl);
      document.body.appendChild(self.panelEl);

      // Wire up events
      self.panelEl.querySelector('.saic-auto-close').addEventListener('click', function () {
        self.panelEl.style.display = 'none';
      });

      var startBtn = self.panelEl.querySelector('.saic-auto-start');
      var pauseBtn = self.panelEl.querySelector('.saic-auto-pause');

      startBtn.addEventListener('click', function () {
        if (self.state === 'idle' || self.state === 'stopped') {
          self.config.interval = Math.max(120, Math.min(300, parseInt(self.panelEl.querySelector('.saic-auto-cfg-interval').value, 10) || 60));
          self.config.stopLimit = Math.max(0, parseInt(self.panelEl.querySelector('.saic-auto-cfg-limit').value, 10) || 0);
          self.reviewMode = self.panelEl.querySelector('.saic-auto-cfg-review').checked;
          self.start();
        } else if (self.state === 'paused') {
          self.resume();
        }
      });

      pauseBtn.addEventListener('click', function () {
        if (self.state === 'running') {
          self.pause();
        } else if (self.state === 'paused') {
          self.resume();
        }
      });

      self.panelEl.querySelector('.saic-auto-gear').addEventListener('click', function () {
        var config = self.panelEl.querySelector('.saic-auto-config');
        config.classList.toggle('open');
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

      var isDragging = false;
      var startX = 0, startY = 0, startLeft = 0, startTop = 0;

      header.addEventListener('mousedown', function (e) {
        if (e.target.closest('.saic-auto-close')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        var rect = self.panelEl.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        self.panelEl.style.left = startLeft + 'px';
        self.panelEl.style.top = startTop + 'px';
        self.panelEl.style.right = 'auto';
        self.panelEl.style.bottom = 'auto';
        header.style.cursor = 'grabbing';
        e.preventDefault();
      });

      document.addEventListener('mousemove', function (e) {
        if (!isDragging) return;
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        self.panelEl.style.left = (startLeft + dx) + 'px';
        self.panelEl.style.top = (startTop + dy) + 'px';
        self.panelEl.style.right = 'auto';
        self.panelEl.style.bottom = 'auto';
      });

      document.addEventListener('mouseup', function () {
        if (isDragging) {
          isDragging = false;
          header.style.cursor = 'grab';
        }
      });
    },

    updateUI: function () {
      var self = this;
      if (!self.panelEl) return;

      var dot = self.panelEl.querySelector('.saic-auto-dot');
      var statusText = self.panelEl.querySelector('.saic-auto-status-text');
      var startBtn = self.panelEl.querySelector('.saic-auto-start');
      var pauseBtn = self.panelEl.querySelector('.saic-auto-pause');
      var timerEl = self.panelEl.querySelector('.saic-auto-timer');
      var commentsStrong = self.panelEl.querySelector('.saic-auto-stat strong');
      var limitEl = self.panelEl.querySelector('.saic-auto-limit');
      var elapsedEl = self.panelEl.querySelector('.saic-auto-elapsed');

      dot.className = 'saic-auto-dot';

      switch (self.state) {
        case 'idle':
          dot.classList.add('stopped');
          statusText.textContent = 'Idle';
          startBtn.textContent = 'Start';
          startBtn.className = 'saic-auto-toggle-btn saic-auto-start';
          startBtn.style.display = '';
          pauseBtn.style.display = 'none';
          timerEl.textContent = '';
          self.btnEl.className = 'saic-auto-btn';
          self.btnEl.textContent = '\u25B6';
          break;
        case 'running':
          dot.classList.add('running');
          statusText.textContent = 'Running';
          startBtn.style.display = 'none';
          pauseBtn.textContent = 'Pause';
          pauseBtn.className = 'saic-auto-toggle-btn saic-auto-pause';
          pauseBtn.style.display = '';
          self.btnEl.className = 'saic-auto-btn running';
          self.btnEl.textContent = '\u23F8';
          break;
        case 'paused':
          dot.classList.add('paused');
          statusText.textContent = 'Paused';
          startBtn.textContent = 'Resume';
          startBtn.className = 'saic-auto-toggle-btn saic-auto-start';
          startBtn.style.display = '';
          pauseBtn.style.display = 'none';
          self.btnEl.className = 'saic-auto-btn';
          self.btnEl.textContent = '\u25B6';
          break;
        case 'stopped':
          dot.classList.add('stopped');
          statusText.textContent = 'Stopped (' + self.stats.commentsMade + ' comments)';
          startBtn.textContent = 'Restart';
          startBtn.className = 'saic-auto-toggle-btn saic-auto-start';
          startBtn.style.display = '';
          pauseBtn.style.display = 'none';
          timerEl.textContent = '';
          self.btnEl.className = 'saic-auto-btn';
          self.btnEl.textContent = '\u25B6';
          break;
      }

      if (commentsStrong) commentsStrong.textContent = self.stats.commentsMade;
      if (limitEl) limitEl.textContent = self.config.stopLimit || '\u221E';
      if (elapsedEl) elapsedEl.textContent = self.formatElapsed();

      var cfgInterval = self.panelEl.querySelector('.saic-auto-cfg-interval');
      var cfgLimit = self.panelEl.querySelector('.saic-auto-cfg-limit');
      if (cfgInterval) cfgInterval.value = self.config.interval;
      if (cfgLimit) cfgLimit.value = self.config.stopLimit;
    },

    formatElapsed: function () {
      if (!this.stats.startTime) return '0:00';
      var ms = Date.now() - this.stats.startTime;
      var secs = Math.floor(ms / 1000);
      var mins = Math.floor(secs / 60);
      var hrs = Math.floor(mins / 60);
      if (hrs > 0) {
        return hrs + ':' + String(mins % 60).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
      }
      return mins + ':' + String(secs % 60).padStart(2, '0');
    },

    // ── Initialization ──
    init: function () {
      if (!platformConfig || !platformConfig.postSelector) return;
      this.loadConfig();
      this.createPanel();
      console.log('[SAIC-Auto] Panel created for ' + platformName);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
