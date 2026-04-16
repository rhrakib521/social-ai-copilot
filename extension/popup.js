// popup.js
// Settings panel for Social AI Copilot extension.

(function () {
  'use strict';

  // ── DOM references ──
  var providerSelect = document.getElementById('provider');
  var apiKeyGroup = document.getElementById('apiKeyGroup');
  var apiKeyInput = document.getElementById('apiKey');
  var openaiModelGroup = document.getElementById('openaiModelGroup');
  var openaiModelSelect = document.getElementById('openaiModel');
  var openaiModelCustom = document.getElementById('openaiModelCustom');
  var glmModelGroup = document.getElementById('glmModelGroup');
  var glmModelSelect = document.getElementById('glmModel');
  var glmModelCustom = document.getElementById('glmModelCustom');
  var geminiModelGroup = document.getElementById('geminiModelGroup');
  var geminiModelSelect = document.getElementById('geminiModel');
  var geminiModelCustom = document.getElementById('geminiModelCustom');
  var deepseekModelGroup = document.getElementById('deepseekModelGroup');
  var deepseekModelSelect = document.getElementById('deepseekModel');
  var deepseekModelCustom = document.getElementById('deepseekModelCustom');
  var qwenModelGroup = document.getElementById('qwenModelGroup');
  var qwenModelSelect = document.getElementById('qwenModel');
  var qwenModelCustom = document.getElementById('qwenModelCustom');
  var backendTokenGroup = document.getElementById('backendTokenGroup');
  var backendTokenInput = document.getElementById('backendToken');
  var defaultToneSelect = document.getElementById('defaultTone');
  var historyList = document.getElementById('historyList');
  var clearHistoryBtn = document.getElementById('clearHistoryBtn');
  var saveBtn = document.getElementById('saveBtn');
  var statusEl = document.getElementById('status');

  var allModelGroups = [openaiModelGroup, glmModelGroup, geminiModelGroup, deepseekModelGroup, qwenModelGroup];

  // ── Toggle provider UI ──
  function updateProviderUI() {
    var provider = providerSelect.value;

    // Hide all model groups first
    allModelGroups.forEach(function (g) { g.classList.add('hidden'); });
    backendTokenGroup.classList.add('hidden');
    apiKeyGroup.classList.remove('hidden');

    if (provider === 'backend') {
      apiKeyGroup.classList.add('hidden');
      backendTokenGroup.classList.remove('hidden');
    } else if (provider === 'openai') {
      apiKeyInput.placeholder = 'sk-...';
      openaiModelGroup.classList.remove('hidden');
    } else if (provider === 'glm') {
      apiKeyInput.placeholder = 'your-zhipu-api-key (id.secret)';
      glmModelGroup.classList.remove('hidden');
    } else if (provider === 'gemini') {
      apiKeyInput.placeholder = 'your-google-ai-api-key';
      geminiModelGroup.classList.remove('hidden');
    } else if (provider === 'deepseek') {
      apiKeyInput.placeholder = 'sk-...';
      deepseekModelGroup.classList.remove('hidden');
    } else if (provider === 'qwen') {
      apiKeyInput.placeholder = 'sk-...';
      qwenModelGroup.classList.remove('hidden');
    }
  }

  // ── Generic custom model toggle for any provider ──
  function setupCustomModelToggle(selectEl, customInput) {
    selectEl.addEventListener('change', function () {
      if (selectEl.value === 'custom') {
        customInput.classList.remove('hidden');
        customInput.focus();
      } else {
        customInput.classList.add('hidden');
      }
    });
  }

  setupCustomModelToggle(openaiModelSelect, openaiModelCustom);
  setupCustomModelToggle(glmModelSelect, glmModelCustom);
  setupCustomModelToggle(geminiModelSelect, geminiModelCustom);
  setupCustomModelToggle(deepseekModelSelect, deepseekModelCustom);
  setupCustomModelToggle(qwenModelSelect, qwenModelCustom);

  // ── Get/set model value helpers ──
  function getModelValue(selectEl, customInput, defaultVal) {
    if (selectEl.value === 'custom') {
      return customInput.value.trim() || defaultVal;
    }
    return selectEl.value;
  }

  function setModelUI(selectEl, customInput, modelValue) {
    var options = Array.from(selectEl.options).map(function (o) { return o.value; });
    if (options.indexOf(modelValue) >= 0) {
      selectEl.value = modelValue;
      customInput.classList.add('hidden');
    } else {
      selectEl.value = 'custom';
      customInput.value = modelValue;
      customInput.classList.remove('hidden');
    }
  }

  providerSelect.addEventListener('change', updateProviderUI);

  // ── Load settings ──
  function loadSettings() {
    chrome.runtime.sendMessage({ type: 'getSettings' }, function (settings) {
      if (!settings) return;
      providerSelect.value = settings.provider || 'openai';
      apiKeyInput.value = settings.apiKey || '';
      backendTokenInput.value = settings.backendToken || '';
      defaultToneSelect.value = settings.defaultTone || 'casual';

      if (settings.openaiModel) setModelUI(openaiModelSelect, openaiModelCustom, settings.openaiModel);
      if (settings.glmModel) setModelUI(glmModelSelect, glmModelCustom, settings.glmModel);
      if (settings.geminiModel) setModelUI(geminiModelSelect, geminiModelCustom, settings.geminiModel);
      if (settings.deepseekModel) setModelUI(deepseekModelSelect, deepseekModelCustom, settings.deepseekModel);
      if (settings.qwenModel) setModelUI(qwenModelSelect, qwenModelCustom, settings.qwenModel);

      var platforms = settings.platforms || {};
      document.getElementById('platform-linkedin').checked = platforms.linkedin !== false;
      document.getElementById('platform-facebook').checked = platforms.facebook !== false;
      document.getElementById('platform-x').checked = platforms.x !== false;
      document.getElementById('platform-reddit').checked = platforms.reddit !== false;

      updateProviderUI();

      // Load contexts
      contexts = settings.contexts || [];
      renderContexts();
    });
  }

  // ── Save settings ──
  saveBtn.addEventListener('click', function () {
    var data = {
      provider: providerSelect.value,
      apiKey: apiKeyInput.value,
      openaiModel: getModelValue(openaiModelSelect, openaiModelCustom, 'gpt-4.1-mini'),
      glmModel: getModelValue(glmModelSelect, glmModelCustom, 'glm-5.1'),
      geminiModel: getModelValue(geminiModelSelect, geminiModelCustom, 'gemini-2.5-flash'),
      deepseekModel: getModelValue(deepseekModelSelect, deepseekModelCustom, 'deepseek-chat'),
      qwenModel: getModelValue(qwenModelSelect, qwenModelCustom, 'qwen-plus'),
      backendToken: backendTokenInput.value,
      contexts: contexts,
      defaultTone: defaultToneSelect.value,
      platforms: {
        linkedin: document.getElementById('platform-linkedin').checked,
        facebook: document.getElementById('platform-facebook').checked,
        x: document.getElementById('platform-x').checked,
        reddit: document.getElementById('platform-reddit').checked
      }
    };

    chrome.runtime.sendMessage({ type: 'saveSettings', data: data }, function (response) {
      if (response && response.ok) {
        statusEl.classList.add('show');
        setTimeout(function () { statusEl.classList.remove('show'); }, 2000);
      }
    });
  });

  // ── Load history ──
  function loadHistory() {
    chrome.runtime.sendMessage({ type: 'getHistory' }, function (history) {
      historyList.innerHTML = '';

      if (!history || history.length === 0) {
        var emptyEl = document.createElement('div');
        emptyEl.style.color = '#94a3b8';
        emptyEl.style.fontSize = '12px';
        emptyEl.style.padding = '4px 0';
        emptyEl.textContent = 'No generation history yet.';
        historyList.appendChild(emptyEl);
        return;
      }

      var entries = history.slice(0, 10);
      entries.forEach(function (entry) {
        var item = document.createElement('div');
        item.className = 'history-item';

        var text = document.createElement('div');
        text.className = 'output-text';
        var outputText = entry.output || '';
        text.textContent = outputText.substring(0, 80) + (outputText.length > 80 ? '...' : '');
        item.appendChild(text);

        var meta = document.createElement('div');
        meta.className = 'meta';
        var date = new Date(entry.timestamp);
        meta.textContent =
          (entry.platform || '') + ' / ' +
          (entry.task || '') + ' / ' +
          date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        item.appendChild(meta);

        historyList.appendChild(item);
      });
    });
  }

  // ── Clear history ──
  clearHistoryBtn.addEventListener('click', function () {
    if (confirm('Clear all generation history?')) {
      chrome.runtime.sendMessage({ type: 'clearHistory' }, function () {
        loadHistory();
      });
    }
  });

  // ── Context management ──
  var contexts = [];
  var editingContextId = null;
  var contextList = document.getElementById('contextList');
  var contextEditor = document.getElementById('contextEditor');
  var addContextBtn = document.getElementById('addContextBtn');
  var contextName = document.getElementById('contextName');
  var contextBody = document.getElementById('contextBody');
  var contextIsDefault = document.getElementById('contextIsDefault');
  var wordCountEl = document.getElementById('wordCount');
  var saveContextBtn = document.getElementById('saveContextBtn');
  var cancelContextBtn = document.getElementById('cancelContextBtn');

  function getWordCount(text) {
    var trimmed = text.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  }

  contextBody.addEventListener('input', function () {
    var words = getWordCount(contextBody.value);
    wordCountEl.textContent = words;
    wordCountEl.style.color = words > 500 ? '#ef4444' : '#94a3b8';
    contextBody.style.borderColor = '';
  });

  contextName.addEventListener('input', function () {
    contextName.style.borderColor = '';
  });

  function renderContexts() {
    contextList.innerHTML = '';
    if (contexts.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'color:#94a3b8;font-size:11px;padding:4px 0;';
      empty.textContent = 'No contexts added yet.';
      contextList.appendChild(empty);
      return;
    }

    contexts.forEach(function (ctx) {
      var item = document.createElement('div');
      item.className = 'ctx-item';

      var info = document.createElement('div');
      info.className = 'ctx-info';

      var nameEl = document.createElement('div');
      nameEl.className = 'ctx-name';
      nameEl.textContent = ctx.name;
      if (ctx.isDefault) {
        var badge = document.createElement('span');
        badge.className = 'ctx-badge';
        badge.textContent = 'DEFAULT';
        nameEl.appendChild(badge);
      }
      info.appendChild(nameEl);

      var preview = document.createElement('div');
      preview.className = 'ctx-preview';
      preview.textContent = ctx.body.substring(0, 60) + (ctx.body.length > 60 ? '...' : '');
      info.appendChild(preview);

      item.appendChild(info);

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'ctx-btn ctx-btn-edit';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', function () { openContextEditor(ctx.id); });
      item.appendChild(editBtn);

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'ctx-btn ctx-btn-del';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', function () { deleteContext(ctx.id); });
      item.appendChild(delBtn);

      contextList.appendChild(item);
    });
  }

  function openContextEditor(id) {
    editingContextId = id || null;
    if (id) {
      var ctx = contexts.find(function (c) { return c.id === id; });
      if (ctx) {
        contextName.value = ctx.name;
        contextBody.value = ctx.body;
        contextIsDefault.checked = ctx.isDefault;
      }
    } else {
      contextName.value = '';
      contextBody.value = '';
      contextIsDefault.checked = contexts.length === 0;
    }
    wordCountEl.textContent = getWordCount(contextBody.value);
    contextEditor.classList.remove('hidden');
    addContextBtn.classList.add('hidden');
    contextName.focus();
  }

  function closeContextEditor() {
    editingContextId = null;
    contextEditor.classList.add('hidden');
    addContextBtn.classList.remove('hidden');
  }

  function saveContextToSettings() {
    // Persist contexts into settings so background.js and content.js can read them
    chrome.runtime.sendMessage({ type: 'saveSettings', data: { contexts: contexts } }, function () {});
  }

  addContextBtn.addEventListener('click', function () { openContextEditor(null); });
  cancelContextBtn.addEventListener('click', closeContextEditor);

  saveContextBtn.addEventListener('click', function () {
    var name = contextName.value.trim();
    var body = contextBody.value.trim();
    var words = getWordCount(body);

    if (!name) { contextName.style.borderColor = '#ef4444'; return; }
    if (!body) { contextBody.style.borderColor = '#ef4444'; return; }
    if (words > 500) { wordCountEl.style.color = '#ef4444'; return; }

    var isDefault = contextIsDefault.checked;
    if (isDefault) {
      contexts.forEach(function (c) { c.isDefault = false; });
    }

    if (editingContextId) {
      var ctx = contexts.find(function (c) { return c.id === editingContextId; });
      if (ctx) {
        ctx.name = name;
        ctx.body = body;
        ctx.isDefault = isDefault;
      }
    } else {
      var newCtx = {
        id: 'ctx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        name: name,
        body: body,
        isDefault: isDefault || contexts.length === 0
      };
      contexts.push(newCtx);
    }

    saveContextToSettings();
    renderContexts();
    closeContextEditor();
  });

  function deleteContext(id) {
    var ctx = contexts.find(function (c) { return c.id === id; });
    if (!ctx) return;
    if (!confirm('Delete context "' + ctx.name + '"?')) return;

    var wasDefault = ctx.isDefault;
    contexts = contexts.filter(function (c) { return c.id !== id; });

    // Transfer default to first remaining
    if (wasDefault && contexts.length > 0) {
      contexts[0].isDefault = true;
    }

    saveContextToSettings();
    renderContexts();
  }

  // ── Initialize ──
  loadSettings();
  loadHistory();
})();
