// popup.js
// Settings panel for Social AI Copilot extension.

(function () {
  'use strict';

  // ── DOM references ──
  var providerSelect = document.getElementById('provider');
  var apiKeyGroup = document.getElementById('apiKeyGroup');
  var apiKeyInput = document.getElementById('apiKey');
  var backendTokenGroup = document.getElementById('backendTokenGroup');
  var backendTokenInput = document.getElementById('backendToken');
  var defaultToneSelect = document.getElementById('defaultTone');
  var historyList = document.getElementById('historyList');
  var clearHistoryBtn = document.getElementById('clearHistoryBtn');
  var saveBtn = document.getElementById('saveBtn');
  var statusEl = document.getElementById('status');

  // ── Toggle provider UI ──
  function updateProviderUI() {
    var provider = providerSelect.value;
    if (provider === 'backend') {
      apiKeyGroup.classList.add('hidden');
      backendTokenGroup.classList.remove('hidden');
    } else {
      apiKeyGroup.classList.remove('hidden');
      backendTokenGroup.classList.add('hidden');
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
