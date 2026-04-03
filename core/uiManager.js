// core/uiManager.js
// Creates and manages the AI trigger button and floating popover.
// All DOM creation uses createElement — no innerHTML with user data.

var currentPopover = null;
var currentTrigger = null;

/**
 * Create the AI trigger button and anchor it next to the given editable field.
 * @param {HTMLElement} field
 * @returns {{ trigger: HTMLElement, field: HTMLElement }}
 */
export function createTrigger(field) {
  removeExistingTrigger();

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
  positionTrigger(wrapper, field);

  currentTrigger = { trigger: trigger, wrapper: wrapper, field: field };

  return currentTrigger;
}

function positionTrigger(wrapper, field) {
  var rect = field.getBoundingClientRect();
  wrapper.style.position = 'fixed';
  wrapper.style.left = (rect.right - 44) + 'px';
  wrapper.style.top = (rect.bottom + 4) + 'px';
  wrapper.style.zIndex = '999998';
}

function removeExistingTrigger() {
  if (currentTrigger && currentTrigger.wrapper && currentTrigger.wrapper.parentNode) {
    currentTrigger.wrapper.parentNode.removeChild(currentTrigger.wrapper);
  }
  currentTrigger = null;
}

/**
 * Show the popover panel anchored to the trigger button.
 * @param {HTMLElement} triggerEl
 * @param {{ onAction: Function, onClose: Function, defaultTone: string }} options
 * @returns {{ el: HTMLElement, setContent: Function, setLoading: Function, setError: Function, getTone: Function, onInsert: Function, hide: Function }}
 */
export function showPopover(triggerEl, options) {
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
  closeBtn.addEventListener('click', function() {
    hidePopover();
    if (options.onClose) options.onClose();
  });
  header.appendChild(closeBtn);
  popover.appendChild(header);

  // Action buttons
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

  actionTypes.forEach(function(action) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'saic-action-btn';
    btn.textContent = action.label;
    btn.setAttribute('data-action', action.id);
    btn.addEventListener('click', function() {
      if (options.onAction) options.onAction(action.id);
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
  var tones = ['professional', 'casual', 'witty', 'direct'];
  tones.forEach(function(t) {
    var opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
    if (options.defaultTone && t === options.defaultTone) opt.selected = true;
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

  // Position the popover
  var triggerRect = triggerEl.getBoundingClientRect();
  popover.style.position = 'fixed';
  popover.style.left = Math.max(8, triggerRect.left - 180) + 'px';
  popover.style.top = (triggerRect.bottom + 8) + 'px';
  popover.style.zIndex = '999999';

  document.body.appendChild(popover);
  currentPopover = popover;

  return {
    el: popover,
    toneSelect: toneSelect,

    setContent: function(text) {
      resultArea.style.display = 'block';
      resultArea.textContent = text;
      insertBtn.style.display = 'block';
      regenBtn.style.display = 'block';
    },

    setLoading: function(isLoading) {
      if (isLoading) {
        resultArea.style.display = 'block';
        resultArea.textContent = 'Generating...';
        resultArea.className = 'saic-result-area saic-loading';
        insertBtn.style.display = 'none';
        regenBtn.style.display = 'none';
      } else {
        resultArea.className = 'saic-result-area';
      }
    },

    setError: function(message) {
      resultArea.style.display = 'block';
      resultArea.textContent = 'Error: ' + message;
      resultArea.className = 'saic-result-area saic-error';
      insertBtn.style.display = 'none';
      regenBtn.style.display = 'none';
    },

    getTone: function() {
      return toneSelect.value;
    },

    onInsert: function(callback) {
      insertBtn.addEventListener('click', function() {
        if (callback) callback(resultArea.textContent);
      });
    },

    onRegenerate: function(callback) {
      regenBtn.addEventListener('click', function() {
        if (callback) callback();
      });
    },

    hide: function() {
      hidePopover();
    }
  };
}

export function hidePopover() {
  if (currentPopover && currentPopover.parentNode) {
    currentPopover.parentNode.removeChild(currentPopover);
  }
  currentPopover = null;
}

/**
 * Insert generated text into the target editable field.
 * @param {HTMLElement} field
 * @param {string} text
 */
export function insertText(field, text) {
  if (window.__saic_insertTextAtCursor) {
    window.__saic_insertTextAtCursor(field, text);
  } else {
    field.focus();
    document.execCommand('insertText', false, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
