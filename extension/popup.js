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
  var historyList = document.getElementById('historyList');
  var clearHistoryBtn = document.getElementById('clearHistoryBtn');
  var saveBtn = document.getElementById('saveBtn');
  var statusEl = document.getElementById('status');

  var allModelGroups = [openaiModelGroup, glmModelGroup, geminiModelGroup, deepseekModelGroup, qwenModelGroup];

  // ── Tab switching ──
  var tabButtons = document.querySelectorAll('.tab-bar .tab');
  var tabPanels = document.querySelectorAll('.tab-panel');

  function switchTab(tabName) {
    tabButtons.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });
    tabPanels.forEach(function (panel) {
      panel.classList.toggle('active', panel.id === 'panel-' + tabName);
    });
    chrome.storage.local.set({ saic_activeTab: tabName });
  }

  tabButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      switchTab(btn.getAttribute('data-tab'));
    });
  });

  chrome.storage.local.get('saic_activeTab', function (result) {
    if (result.saic_activeTab) switchTab(result.saic_activeTab);
  });

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

  // ── Priority targets with platform checkboxes ──
  var priorityTargetsData = [];

  function renderPriorityTargets(targets) {
    priorityTargetsData = targets || [];
    var list = document.getElementById('priorityTargetsList');
    if (!list) return;
    list.innerHTML = '';

    if (priorityTargetsData.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'color:#94a3b8;font-size:11px;padding:4px 0;';
      empty.textContent = 'No priority targets added.';
      list.appendChild(empty);
      return;
    }

    priorityTargetsData.forEach(function (target, idx) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:6px;background:#fff;';

      var nameEl = document.createElement('span');
      nameEl.style.cssText = 'flex:1;font-size:12px;font-weight:500;color:#1e293b;';
      nameEl.textContent = target.name;
      row.appendChild(nameEl);

      ['linkedin', 'facebook', 'x', 'reddit'].forEach(function (p) {
        var lbl = document.createElement('label');
        lbl.style.cssText = 'font-size:10px;color:#64748b;cursor:pointer;display:flex;align-items:center;gap:2px;';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.style.cssText = 'width:auto;margin:0;';
        cb.checked = (target.platforms || []).indexOf(p) !== -1;
        cb.addEventListener('change', function () {
          var t = priorityTargetsData[idx];
          if (!t.platforms) t.platforms = [];
          if (cb.checked) {
            if (t.platforms.indexOf(p) === -1) t.platforms.push(p);
          } else {
            t.platforms = t.platforms.filter(function (x) { return x !== p; });
          }
        });
        var shortName = p === 'linkedin' ? 'LI' : p === 'facebook' ? 'FB' : p === 'x' ? 'X' : 'RE';
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(shortName));
        row.appendChild(lbl);
      });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.style.cssText = 'border:none;background:none;color:#ef4444;cursor:pointer;font-size:11px;padding:2px 4px;';
      delBtn.textContent = 'x';
      delBtn.addEventListener('click', function () {
        priorityTargetsData.splice(idx, 1);
        renderPriorityTargets(priorityTargetsData);
      });
      row.appendChild(delBtn);

      list.appendChild(row);
    });
  }

  function collectPriorityTargets() {
    return priorityTargetsData.filter(function (t) { return t.name; });
  }

  var addTargetBtn = document.getElementById('addTargetBtn');
  if (addTargetBtn) {
    addTargetBtn.addEventListener('click', function () {
      var input = document.getElementById('newTargetName');
      var name = (input.value || '').trim();
      if (!name) return;
      priorityTargetsData.push({ name: name, platforms: ['linkedin', 'facebook', 'x', 'reddit'], type: 'person' });
      input.value = '';
      renderPriorityTargets(priorityTargetsData);
    });
  }

  // ── Load settings ──
  function loadSettings() {
    chrome.runtime.sendMessage({ type: 'getSettings' }, function (settings) {
      if (!settings) return;
      providerSelect.value = settings.provider || 'openai';
      apiKeyInput.value = settings.apiKey || '';
      backendTokenInput.value = settings.backendToken || '';

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

      // Load per-platform settings
      var ps = settings.platformSettings || {};
      ['linkedin', 'facebook', 'x', 'reddit'].forEach(function (platform) {
        var p = ps[platform] || {};
        var toneEl = document.getElementById('ps-' + platform + '-tone');
        if (toneEl) toneEl.value = p.tone || 'casual';

        var intervalEl = document.getElementById('ps-' + platform + '-interval');
        if (intervalEl) intervalEl.value = p.interval || 60;

        var stopEl = document.getElementById('ps-' + platform + '-stopLimit');
        if (stopEl) stopEl.value = p.stopLimit || 0;

        var submitEl = document.getElementById('ps-' + platform + '-autoSubmit');
        if (submitEl) submitEl.checked = p.autoSubmit !== false;

        var filterEl = document.getElementById('ps-' + platform + '-contentFilter');
        if (filterEl) filterEl.value = p.contentFilter || 'business';

        var mentionEl = document.getElementById('ps-' + platform + '-mentionPages');
        if (mentionEl) mentionEl.value = (p.mentionPages || []).join('\n');

        // Load instruction presets
        var PRESET_IDS = ['use_emojis', 'ask_questions', 'keep_short', 'use_hashtags', 'be_empathetic', 'include_cta', 'avoid_jargon', 'professional'];
        var activePresets = p.instructionPresets || [];
        PRESET_IDS.forEach(function (presetId) {
          var cb = document.getElementById('ps-' + platform + '-preset-' + presetId);
          if (cb) cb.checked = activePresets.indexOf(presetId) !== -1;
        });

        // Load custom instructions
        var customEl = document.getElementById('ps-' + platform + '-customInstructions');
        if (customEl) customEl.value = p.customInstructions || '';

        // Platform-specific thresholds
        var thresholds = p.engagementThresholds || {};
        if (platform === 'linkedin' || platform === 'facebook') {
          var rEl = document.getElementById('ps-' + platform + '-minReactions');
          if (rEl) rEl.value = thresholds.minReactions || (platform === 'facebook' ? 30 : 50);
          var cEl = document.getElementById('ps-' + platform + '-minComments');
          if (cEl) cEl.value = thresholds.minComments || (platform === 'facebook' ? 5 : 10);
        } else if (platform === 'x') {
          var lEl = document.getElementById('ps-x-minLikes');
          if (lEl) lEl.value = thresholds.minLikes || 100;
          var rtEl = document.getElementById('ps-x-minRetweets');
          if (rtEl) rtEl.value = thresholds.minRetweets || 20;
        } else if (platform === 'reddit') {
          var uEl = document.getElementById('ps-reddit-minUpvotes');
          if (uEl) uEl.value = thresholds.minUpvotes || 50;
          var rcEl = document.getElementById('ps-reddit-minComments');
          if (rcEl) rcEl.value = thresholds.minComments || 10;
          // Reddit-specific fields
          var targetSubs = document.getElementById('ps-reddit-targetSubreddits');
          if (targetSubs) targetSubs.value = (p.targetSubreddits || []).join('\n');
          var blackSubs = document.getElementById('ps-reddit-blacklistSubreddits');
          if (blackSubs) blackSubs.value = (p.blacklistSubreddits || []).join('\n');
          var autoDetect = document.getElementById('ps-reddit-autoDetectGenre');
          if (autoDetect) autoDetect.checked = p.autoDetectGenre !== false;
          var bizName = document.getElementById('ps-reddit-businessName');
          if (bizName) bizName.value = p.businessName || '';
          var bizDesc = document.getElementById('ps-reddit-businessDescription');
          if (bizDesc) bizDesc.value = p.businessDescription || '';
          var freqSlider = document.getElementById('ps-reddit-mentionFrequency');
          if (freqSlider) { freqSlider.value = p.mentionFrequency !== undefined ? p.mentionFrequency : 15; }
          var freqVal = document.getElementById('ps-reddit-mentionFrequencyValue');
          if (freqVal) freqVal.textContent = freqSlider ? freqSlider.value : '15';
          var rateSlider = document.getElementById('ps-reddit-maxCommentsPerHour');
          if (rateSlider) { rateSlider.value = p.maxCommentsPerHour || 3; }
          var rateVal = document.getElementById('ps-reddit-maxCommentsPerHourValue');
          if (rateVal) rateVal.textContent = rateSlider ? rateSlider.value : '3';
          var skipNew = document.getElementById('ps-reddit-skipNewPostsMinutes');
          if (skipNew) skipNew.value = p.skipNewPostsMinutes || 60;
          var skipBot = document.getElementById('ps-reddit-skipBotRestrictedSubs');
          if (skipBot) skipBot.checked = p.skipBotRestrictedSubs !== false;
        }
      });

      // Populate active context dropdowns per platform
      ['linkedin', 'facebook', 'x', 'reddit'].forEach(function (platform) {
        var ctxSelect = document.getElementById('ps-' + platform + '-activeContext');
        if (!ctxSelect) return;
        ctxSelect.innerHTML = '<option value="">None</option>';
        contexts.forEach(function (ctx) {
          var opt = document.createElement('option');
          opt.value = ctx.id;
          opt.textContent = ctx.name;
          ctxSelect.appendChild(opt);
        });
        var activeCtx = (ps[platform] || {}).activeContext || '';
        ctxSelect.value = activeCtx;
      });

      // Load priority targets with platform checkboxes
      renderPriorityTargets(settings.priorityTargets || []);
    });
  }

  // ── Save settings ──
  saveBtn.addEventListener('click', function () {
    var platformSettings = {};
    ['linkedin', 'facebook', 'x', 'reddit'].forEach(function (platform) {
      var thresholds = {};
      if (platform === 'linkedin' || platform === 'facebook') {
        thresholds.minReactions = parseInt(document.getElementById('ps-' + platform + '-minReactions').value, 10) || (platform === 'facebook' ? 30 : 50);
        thresholds.minComments = parseInt(document.getElementById('ps-' + platform + '-minComments').value, 10) || (platform === 'facebook' ? 5 : 10);
      } else if (platform === 'x') {
        thresholds.minLikes = parseInt(document.getElementById('ps-x-minLikes').value, 10) || 100;
        thresholds.minRetweets = parseInt(document.getElementById('ps-x-minRetweets').value, 10) || 20;
      } else if (platform === 'reddit') {
        thresholds.minUpvotes = parseInt(document.getElementById('ps-reddit-minUpvotes').value, 10) || 50;
        thresholds.minComments = parseInt(document.getElementById('ps-reddit-minComments').value, 10) || 10;
      }

      var mentionVal = (document.getElementById('ps-' + platform + '-mentionPages').value || '').trim();
      var mentionPages = mentionVal ? mentionVal.split('\n').map(function (s) { return s.trim(); }).filter(Boolean) : [];

      platformSettings[platform] = {
        tone: (document.getElementById('ps-' + platform + '-tone') || {}).value || 'casual',
        activeContext: (document.getElementById('ps-' + platform + '-activeContext') || {}).value || '',
        instructionPresets: (function () {
          var PRESET_IDS = ['use_emojis', 'ask_questions', 'keep_short', 'use_hashtags', 'be_empathetic', 'include_cta', 'avoid_jargon', 'professional'];
          var checked = [];
          PRESET_IDS.forEach(function (presetId) {
            var cb = document.getElementById('ps-' + platform + '-preset-' + presetId);
            if (cb && cb.checked) checked.push(presetId);
          });
          return checked;
        })(),
        customInstructions: (document.getElementById('ps-' + platform + '-customInstructions') || {}).value || '',
        interval: parseInt((document.getElementById('ps-' + platform + '-interval') || {}).value, 10) || 60,
        autoSubmit: (document.getElementById('ps-' + platform + '-autoSubmit') || {}).checked !== false,
        contentFilter: (document.getElementById('ps-' + platform + '-contentFilter') || {}).value || 'business',
        stopLimit: parseInt((document.getElementById('ps-' + platform + '-stopLimit') || {}).value, 10) || 0,
        engagementThresholds: thresholds,
        mentionPages: mentionPages
      };

      // Reddit-specific fields
      if (platform === 'reddit') {
        var targetSubsVal = (document.getElementById('ps-reddit-targetSubreddits').value || '').trim();
        var targetSubs = targetSubsVal ? targetSubsVal.split('\n').map(function (s) { return s.trim().replace(/^r\//, ''); }).filter(Boolean) : [];
        var blackSubsVal = (document.getElementById('ps-reddit-blacklistSubreddits').value || '').trim();
        var blackSubs = blackSubsVal ? blackSubsVal.split('\n').map(function (s) { return s.trim().replace(/^r\//, ''); }).filter(Boolean) : [];
        platformSettings[platform].targetSubreddits = targetSubs;
        platformSettings[platform].blacklistSubreddits = blackSubs;
        platformSettings[platform].autoDetectGenre = document.getElementById('ps-reddit-autoDetectGenre').checked;
        platformSettings[platform].businessName = (document.getElementById('ps-reddit-businessName').value || '').trim();
        platformSettings[platform].businessDescription = (document.getElementById('ps-reddit-businessDescription').value || '').trim();
        platformSettings[platform].mentionFrequency = parseInt(document.getElementById('ps-reddit-mentionFrequency').value, 10) || 15;
        platformSettings[platform].maxCommentsPerHour = parseInt(document.getElementById('ps-reddit-maxCommentsPerHour').value, 10) || 3;
        platformSettings[platform].skipNewPostsMinutes = parseInt(document.getElementById('ps-reddit-skipNewPostsMinutes').value, 10) || 60;
        platformSettings[platform].skipBotRestrictedSubs = document.getElementById('ps-reddit-skipBotRestrictedSubs').checked;
      }
    });

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
      priorityTargets: collectPriorityTargets(),
      platforms: {
        linkedin: document.getElementById('platform-linkedin').checked,
        facebook: document.getElementById('platform-facebook').checked,
        x: document.getElementById('platform-x').checked,
        reddit: document.getElementById('platform-reddit').checked
      },
      platformSettings: platformSettings
    };

    chrome.runtime.sendMessage({ type: 'saveSettings', data: data }, function (response) {
      if (response && response.ok) {
        statusEl.classList.add('show');
        setTimeout(function () { statusEl.classList.remove('show'); }, 2000);
      }
    });
  });

  // Reddit slider value displays
  var freqSlider = document.getElementById('ps-reddit-mentionFrequency');
  var freqValue = document.getElementById('ps-reddit-mentionFrequencyValue');
  if (freqSlider && freqValue) {
    freqSlider.addEventListener('input', function () { freqValue.textContent = freqSlider.value; });
  }
  var rateSlider = document.getElementById('ps-reddit-maxCommentsPerHour');
  var rateValue = document.getElementById('ps-reddit-maxCommentsPerHourValue');
  if (rateSlider && rateValue) {
    rateSlider.addEventListener('input', function () { rateValue.textContent = rateSlider.value; });
  }

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
      }
    } else {
      contextName.value = '';
      contextBody.value = '';
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
    // Refresh platform context dropdowns so new/edited contexts appear
    refreshPlatformContextDropdowns();
  }

  function refreshPlatformContextDropdowns() {
    ['linkedin', 'facebook', 'x', 'reddit'].forEach(function (platform) {
      var ctxSelect = document.getElementById('ps-' + platform + '-activeContext');
      if (!ctxSelect) return;
      var currentVal = ctxSelect.value;
      ctxSelect.innerHTML = '<option value="">None</option>';
      contexts.forEach(function (ctx) {
        var opt = document.createElement('option');
        opt.value = ctx.id;
        opt.textContent = ctx.name;
        ctxSelect.appendChild(opt);
      });
      ctxSelect.value = currentVal;
    });
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

    if (editingContextId) {
      var ctx = contexts.find(function (c) { return c.id === editingContextId; });
      if (ctx) {
        ctx.name = name;
        ctx.body = body;
      }
    } else {
      var newCtx = {
        id: 'ctx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        name: name,
        body: body
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

    contexts = contexts.filter(function (c) { return c.id !== id; });

    saveContextToSettings();
    renderContexts();
  }

  // ── Initialize ──
  loadSettings();
  loadHistory();
})();
