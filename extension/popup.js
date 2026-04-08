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
      defaultToneSelect.value = settings.defaultTone || 'professional';

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
    });
  }

  // ── Save settings ──
  saveBtn.addEventListener('click', function () {
    var data = {
      provider: providerSelect.value,
      apiKey: apiKeyInput.value,
      openaiModel: getModelValue(openaiModelSelect, openaiModelCustom, 'gpt-4.1-mini'),
      glmModel: getModelValue(glmModelSelect, glmModelCustom, 'glm-4-flash'),
      geminiModel: getModelValue(geminiModelSelect, geminiModelCustom, 'gemini-2.5-flash'),
      deepseekModel: getModelValue(deepseekModelSelect, deepseekModelCustom, 'deepseek-chat'),
      qwenModel: getModelValue(qwenModelSelect, qwenModelCustom, 'qwen-plus'),
      backendToken: backendTokenInput.value,
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

  // ── Initialize ──
  loadSettings();
  loadHistory();
})();
