# Per-Platform Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split all automation/content settings into per-platform overrides with a tabbed popup UI (General + 4 platform tabs).

**Architecture:** Add a `platformSettings` nested object to `DEFAULT_SETTINGS` in `background.js` with per-platform tone, interval, auto-submit, content filter, stop limit, engagement thresholds, mention pages, and active context. Add a tab bar to `popup.html` with 5 tabs. Modify `popup.js` to populate/save per-platform fields. Update `content.js` AutomationEngine to read from `platformSettings[currentPlatform]` instead of global flat keys.

**Tech Stack:** Chrome Extension MV3, vanilla JS, chrome.storage.local

---

### Task 1: Update DEFAULT_SETTINGS and add migration in background.js

**Files:**
- Modify: `extension/background.js:385-423`

- [ ] **Step 1: Replace DEFAULT_SETTINGS with new structure including platformSettings**

Replace the `DEFAULT_SETTINGS` object (lines 385-410) with:

```js
var DEFAULT_PLATFORM_SETTINGS = {
  tone: 'casual',
  activeContext: '',
  interval: 60,
  autoSubmit: true,
  contentFilter: 'business',
  stopLimit: 0,
  engagementThresholds: {
    minReactions: 50,
    minComments: 10
  },
  mentionPages: []
};

var DEFAULT_SETTINGS = {
  provider: 'openai',
  authMode: 'user_key',
  apiKey: '',
  openaiModel: 'gpt-4.1-mini',
  glmModel: 'glm-5.1',
  geminiModel: 'gemini-2.5-flash',
  deepseekModel: 'deepseek-chat',
  qwenModel: 'qwen-plus',
  backendToken: '',
  contexts: [],
  priorityTargets: [],
  platforms: { linkedin: true, facebook: true, x: true, reddit: true },
  platformSettings: {
    linkedin: {
      ...DEFAULT_PLATFORM_SETTINGS,
      engagementThresholds: { minReactions: 50, minComments: 10 }
    },
    facebook: {
      ...DEFAULT_PLATFORM_SETTINGS,
      engagementThresholds: { minReactions: 30, minComments: 5 }
    },
    x: {
      ...DEFAULT_PLATFORM_SETTINGS,
      engagementThresholds: { minLikes: 100, minRetweets: 20 }
    },
    reddit: {
      ...DEFAULT_PLATFORM_SETTINGS,
      engagementThresholds: { minUpvotes: 50, minComments: 10 }
    }
  }
};
```

- [ ] **Step 2: Add migration logic to getSettings()**

Replace the `getSettings()` function (lines 412-423) with:

```js
function migrateSettings(stored) {
  if (stored.platformSettings) return stored;

  var ps = {};
  var platforms = ['linkedin', 'facebook', 'x', 'reddit'];
  platforms.forEach(function (p) {
    var defaults = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.platformSettings[p]));
    defaults.tone = stored.defaultTone || 'casual';
    defaults.interval = stored.autoInterval || 60;
    defaults.autoSubmit = stored.autoSubmit !== false;
    defaults.contentFilter = stored.contentFilter || 'business';
    defaults.stopLimit = stored.autoStopLimit || 0;
    defaults.mentionPages = stored.autoMentionPages || [];
    if (stored.engagementThresholds && stored.engagementThresholds[p]) {
      defaults.engagementThresholds = { ...defaults.engagementThresholds, ...stored.engagementThresholds[p] };
    }
    ps[p] = defaults;
  });
  stored.platformSettings = ps;
  return stored;
}

async function getSettings() {
  return new Promise(function (resolve) {
    chrome.storage.local.get('socialAiCopilot_settings', function (result) {
      var stored = result.socialAiCopilot_settings || {};
      stored = migrateSettings(stored);
      resolve({
        ...DEFAULT_SETTINGS,
        ...stored,
        platforms: { ...DEFAULT_SETTINGS.platforms, ...(stored.platforms || {}) },
        platformSettings: { ...DEFAULT_SETTINGS.platformSettings, ...(stored.platformSettings || {}) }
      });
    });
  });
}
```

- [ ] **Step 3: Update saveSettings handler to deep-merge platformSettings**

Replace the saveSettings handler (around lines 517-525) with:

```js
  if (message.type === 'saveSettings') {
    (async function () {
      var current = await getSettings();
      var merged = {
        ...current,
        ...message.data,
        platforms: { ...current.platforms, ...(message.data.platforms || {}) }
      };
      if (message.data.platformSettings) {
        merged.platformSettings = { ...current.platformSettings };
        var pKeys = Object.keys(message.data.platformSettings);
        for (var i = 0; i < pKeys.length; i++) {
          var pk = pKeys[i];
          merged.platformSettings[pk] = { ...current.platformSettings[pk], ...message.data.platformSettings[pk] };
          if (message.data.platformSettings[pk].engagementThresholds) {
            merged.platformSettings[pk].engagementThresholds = {
              ...current.platformSettings[pk].engagementThresholds,
              ...message.data.platformSettings[pk].engagementThresholds
            };
          }
        }
      }
      chrome.storage.local.set({ socialAiCopilot_settings: merged }, function () {
        sendResponse({ ok: true });
      });
    })();
    return true;
  }
```

- [ ] **Step 4: Commit**

```bash
git add extension/background.js
git commit -m "feat: add platformSettings data model with migration"
```

---

### Task 2: Update buildPrompt to accept platform-specific tone/context/mentionPages

**Files:**
- Modify: `extension/background.js:291` (buildPrompt signature, no change needed — already accepts params)
- Modify: `extension/background.js:444-509` (generate handler that calls buildPrompt)

- [ ] **Step 1: Update generate handler to pass platform-specific settings**

In the `generate` message handler (around line 445), the `buildPrompt` call already receives `tone`, `contextInfo`, and `mentionPages` from `message.data`. The caller (content.js `classifyAndComment`) will be updated in Task 4 to read from `platformSettings`. No changes needed in the `generate` handler itself — it passes through what it receives.

However, update the `getSettings` call to also make `platformSettings` available. No change needed — `getSettings()` already returns the full merged settings.

- [ ] **Step 2: Commit (if any changes were needed)**

If no changes were needed, skip this commit.

---

### Task 3: Restructure popup.html with tab bar and platform panels

**Files:**
- Modify: `extension/popup.html`

- [ ] **Step 1: Update body CSS and add tab bar CSS**

In the `<style>` block, change `min-height: 500px` to `min-height: 580px` and `max-height: 650px` to `max-height: 700px`. Then add these CSS rules before the closing `</style>` tag:

```css
.tab-bar {
  display: flex;
  background: #f1f5f9;
  border-bottom: 2px solid #e2e8f0;
  padding: 0 4px;
}
.tab-bar .tab {
  flex: 1;
  padding: 8px 4px;
  border: none;
  background: none;
  font-size: 11px;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: color 0.15s, border-color 0.15s;
  white-space: nowrap;
}
.tab-bar .tab:hover { color: #6366f1; }
.tab-bar .tab.active {
  color: #6366f1;
  border-bottom-color: #6366f1;
  font-weight: 600;
}
.tab-panel { display: none; }
.tab-panel.active { display: block; }
```

- [ ] **Step 2: Add tab bar HTML after the header div, before the first section**

Insert after `</div>` (the header closing tag, line 256) and before the first `<div class="section">`:

```html
  <div class="tab-bar">
    <button type="button" class="tab active" data-tab="general">General</button>
    <button type="button" class="tab" data-tab="linkedin">LinkedIn</button>
    <button type="button" class="tab" data-tab="facebook">Facebook</button>
    <button type="button" class="tab" data-tab="x">X</button>
    <button type="button" class="tab" data-tab="reddit">Reddit</button>
  </div>
```

- [ ] **Step 3: Wrap existing settings sections into panel-general**

Wrap all content between the tab bar and the save button (Provider section through Recent History section) in:

```html
  <div id="panel-general" class="tab-panel active">
    <!-- existing Provider, Contexts, Priority Targets, Platforms, Recent History sections go here -->
  </div>
```

Remove the Tone section and the Automation section and the Engagement Thresholds section from General — these move to platform tabs.

- [ ] **Step 4: Add platform tab panels after panel-general, before the save button**

Add four platform panels. Each has the same layout with platform-specific threshold labels:

```html
  <div id="panel-linkedin" class="tab-panel">
    <div class="section">
      <div class="section-title">Content</div>
      <label for="ps-linkedin-tone">Tone</label>
      <select id="ps-linkedin-tone">
        <option value="casual">Casual</option>
        <option value="funny">Funny</option>
        <option value="informative">Informative</option>
      </select>
      <label for="ps-linkedin-activeContext">Active Context</label>
      <select id="ps-linkedin-activeContext">
        <option value="">None</option>
      </select>
    </div>
    <div class="section">
      <div class="section-title">Automation</div>
      <div class="toggle-row">
        <label for="ps-linkedin-autoSubmit">Auto-submit (no review)</label>
        <label class="toggle"><input type="checkbox" id="ps-linkedin-autoSubmit" checked><span class="toggle-slider"></span></label>
      </div>
      <div class="toggle-row" style="margin-top:8px;">
        <label for="ps-linkedin-interval">Interval (seconds)</label>
        <input type="number" id="ps-linkedin-interval" min="30" max="300" value="60" style="width:70px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;text-align:center;">
      </div>
      <div class="toggle-row" style="margin-top:8px;">
        <label for="ps-linkedin-stopLimit">Auto-stop after (0 = unlimited)</label>
        <input type="number" id="ps-linkedin-stopLimit" min="0" max="500" value="0" style="width:70px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;text-align:center;">
      </div>
      <div class="toggle-row" style="margin-top:8px;">
        <label for="ps-linkedin-contentFilter">Content filter</label>
        <select id="ps-linkedin-contentFilter" style="padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;">
          <option value="business">Business / Startup only</option>
          <option value="all">All posts</option>
        </select>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Engagement Thresholds</div>
      <p style="font-size:11px;color:#94a3b8;margin-bottom:8px;">Only comment on posts meeting these minimums. Priority targets bypass these.</p>
      <div class="toggle-row">
        <label style="font-size:11px;">Min reactions</label>
        <input type="number" id="ps-linkedin-minReactions" min="0" max="10000" value="50" style="width:60px;padding:3px 6px;border:1px solid #e2e8f0;border-radius:4px;font-size:11px;color:#1e293b;text-align:center;">
      </div>
      <div class="toggle-row" style="margin-top:4px;">
        <label style="font-size:11px;">Min comments</label>
        <input type="number" id="ps-linkedin-minComments" min="0" max="10000" value="10" style="width:60px;padding:3px 6px;border:1px solid #e2e8f0;border-radius:4px;font-size:11px;color:#1e293b;text-align:center;">
      </div>
    </div>
    <div class="section">
      <div class="section-title">Mention Pages</div>
      <p style="font-size:11px;color:#94a3b8;margin-bottom:8px;">Pages to @mention in auto-comments. One per line.</p>
      <textarea id="ps-linkedin-mentionPages" rows="3" placeholder="Periscale" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:11px;color:#1e293b;font-family:inherit;resize:vertical;"></textarea>
    </div>
  </div>

  <div id="panel-facebook" class="tab-panel">
    <div class="section">
      <div class="section-title">Content</div>
      <label for="ps-facebook-tone">Tone</label>
      <select id="ps-facebook-tone">
        <option value="casual">Casual</option>
        <option value="funny">Funny</option>
        <option value="informative">Informative</option>
      </select>
      <label for="ps-facebook-activeContext">Active Context</label>
      <select id="ps-facebook-activeContext">
        <option value="">None</option>
      </select>
    </div>
    <div class="section">
      <div class="section-title">Automation</div>
      <div class="toggle-row">
        <label for="ps-facebook-autoSubmit">Auto-submit (no review)</label>
        <label class="toggle"><input type="checkbox" id="ps-facebook-autoSubmit" checked><span class="toggle-slider"></span></label>
      </div>
      <div class="toggle-row" style="margin-top:8px;">
        <label for="ps-facebook-interval">Interval (seconds)</label>
        <input type="number" id="ps-facebook-interval" min="30" max="300" value="60" style="width:70px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;text-align:center;">
      </div>
      <div class="toggle-row" style="margin-top:8px;">
        <label for="ps-facebook-stopLimit">Auto-stop after (0 = unlimited)</label>
        <input type="number" id="ps-facebook-stopLimit" min="0" max="500" value="0" style="width:70px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;text-align:center;">
      </div>
      <div class="toggle-row" style="margin-top:8px;">
        <label for="ps-facebook-contentFilter">Content filter</label>
        <select id="ps-facebook-contentFilter" style="padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;">
          <option value="business">Business / Startup only</option>
          <option value="all">All posts</option>
        </select>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Engagement Thresholds</div>
      <p style="font-size:11px;color:#94a3b8;margin-bottom:8px;">Only comment on posts meeting these minimums. Priority targets bypass these.</p>
      <div class="toggle-row">
        <label style="font-size:11px;">Min reactions</label>
        <input type="number" id="ps-facebook-minReactions" min="0" max="10000" value="30" style="width:60px;padding:3px 6px;border:1px solid #e2e8f0;border-radius:4px;font-size:11px;color:#1e293b;text-align:center;">
      </div>
      <div class="toggle-row" style="margin-top:4px;">
        <label style="font-size:11px;">Min comments</label>
        <input type="number" id="ps-facebook-minComments" min="0" max="10000" value="5" style="width:60px;padding:3px 6px;border:1px solid #e2e8f0;border-radius:4px;font-size:11px;color:#1e293b;text-align:center;">
      </div>
    </div>
    <div class="section">
      <div class="section-title">Mention Pages</div>
      <p style="font-size:11px;color:#94a3b8;margin-bottom:8px;">Pages to @mention in auto-comments. One per line.</p>
      <textarea id="ps-facebook-mentionPages" rows="3" placeholder="Periscale" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:11px;color:#1e293b;font-family:inherit;resize:vertical;"></textarea>
    </div>
  </div>

  <div id="panel-x" class="tab-panel">
    <div class="section">
      <div class="section-title">Content</div>
      <label for="ps-x-tone">Tone</label>
      <select id="ps-x-tone">
        <option value="casual">Casual</option>
        <option value="funny">Funny</option>
        <option value="informative">Informative</option>
      </select>
      <label for="ps-x-activeContext">Active Context</label>
      <select id="ps-x-activeContext">
        <option value="">None</option>
      </select>
    </div>
    <div class="section">
      <div class="section-title">Automation</div>
      <div class="toggle-row">
        <label for="ps-x-autoSubmit">Auto-submit (no review)</label>
        <label class="toggle"><input type="checkbox" id="ps-x-autoSubmit" checked><span class="toggle-slider"></span></label>
      </div>
      <div class="toggle-row" style="margin-top:8px;">
        <label for="ps-x-interval">Interval (seconds)</label>
        <input type="number" id="ps-x-interval" min="30" max="300" value="60" style="width:70px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;text-align:center;">
      </div>
      <div class="toggle-row" style="margin-top:8px;">
        <label for="ps-x-stopLimit">Auto-stop after (0 = unlimited)</label>
        <input type="number" id="ps-x-stopLimit" min="0" max="500" value="0" style="width:70px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;text-align:center;">
      </div>
      <div class="toggle-row" style="margin-top:8px;">
        <label for="ps-x-contentFilter">Content filter</label>
        <select id="ps-x-contentFilter" style="padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;">
          <option value="business">Business / Startup only</option>
          <option value="all">All posts</option>
        </select>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Engagement Thresholds</div>
      <p style="font-size:11px;color:#94a3b8;margin-bottom:8px;">Only comment on posts meeting these minimums. Priority targets bypass these.</p>
      <div class="toggle-row">
        <label style="font-size:11px;">Min likes</label>
        <input type="number" id="ps-x-minLikes" min="0" max="100000" value="100" style="width:60px;padding:3px 6px;border:1px solid #e2e8f0;border-radius:4px;font-size:11px;color:#1e293b;text-align:center;">
      </div>
      <div class="toggle-row" style="margin-top:4px;">
        <label style="font-size:11px;">Min retweets</label>
        <input type="number" id="ps-x-minRetweets" min="0" max="100000" value="20" style="width:60px;padding:3px 6px;border:1px solid #e2e8f0;border-radius:4px;font-size:11px;color:#1e293b;text-align:center;">
      </div>
    </div>
    <div class="section">
      <div class="section-title">Mention Pages</div>
      <p style="font-size:11px;color:#94a3b8;margin-bottom:8px;">Pages to @mention in auto-comments. One per line.</p>
      <textarea id="ps-x-mentionPages" rows="3" placeholder="Periscale" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:11px;color:#1e293b;font-family:inherit;resize:vertical;"></textarea>
    </div>
  </div>

  <div id="panel-reddit" class="tab-panel">
    <div class="section">
      <div class="section-title">Content</div>
      <label for="ps-reddit-tone">Tone</label>
      <select id="ps-reddit-tone">
        <option value="casual">Casual</option>
        <option value="funny">Funny</option>
        <option value="informative">Informative</option>
      </select>
      <label for="ps-reddit-activeContext">Active Context</label>
      <select id="ps-reddit-activeContext">
        <option value="">None</option>
      </select>
    </div>
    <div class="section">
      <div class="section-title">Automation</div>
      <div class="toggle-row">
        <label for="ps-reddit-autoSubmit">Auto-submit (no review)</label>
        <label class="toggle"><input type="checkbox" id="ps-reddit-autoSubmit" checked><span class="toggle-slider"></span></label>
      </div>
      <div class="toggle-row" style="margin-top:8px;">
        <label for="ps-reddit-interval">Interval (seconds)</label>
        <input type="number" id="ps-reddit-interval" min="30" max="300" value="60" style="width:70px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;text-align:center;">
      </div>
      <div class="toggle-row" style="margin-top:8px;">
        <label for="ps-reddit-stopLimit">Auto-stop after (0 = unlimited)</label>
        <input type="number" id="ps-reddit-stopLimit" min="0" max="500" value="0" style="width:70px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;text-align:center;">
      </div>
      <div class="toggle-row" style="margin-top:8px;">
        <label for="ps-reddit-contentFilter">Content filter</label>
        <select id="ps-reddit-contentFilter" style="padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;">
          <option value="business">Business / Startup only</option>
          <option value="all">All posts</option>
        </select>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Engagement Thresholds</div>
      <p style="font-size:11px;color:#94a3b8;margin-bottom:8px;">Only comment on posts meeting these minimums. Priority targets bypass these.</p>
      <div class="toggle-row">
        <label style="font-size:11px;">Min upvotes</label>
        <input type="number" id="ps-reddit-minUpvotes" min="0" max="100000" value="50" style="width:60px;padding:3px 6px;border:1px solid #e2e8f0;border-radius:4px;font-size:11px;color:#1e293b;text-align:center;">
      </div>
      <div class="toggle-row" style="margin-top:4px;">
        <label style="font-size:11px;">Min comments</label>
        <input type="number" id="ps-reddit-minComments" min="0" max="100000" value="10" style="width:60px;padding:3px 6px;border:1px solid #e2e8f0;border-radius:4px;font-size:11px;color:#1e293b;text-align:center;">
      </div>
    </div>
    <div class="section">
      <div class="section-title">Mention Pages</div>
      <p style="font-size:11px;color:#94a3b8;margin-bottom:8px;">Pages to @mention in auto-comments. One per line.</p>
      <textarea id="ps-reddit-mentionPages" rows="3" placeholder="Periscale" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:11px;color:#1e293b;font-family:inherit;resize:vertical;"></textarea>
    </div>
  </div>
```

- [ ] **Step 5: Update priority targets in General tab to use per-platform checkboxes**

Replace the priority targets section (in the General panel) with:

```html
  <div class="section">
    <div class="section-title">Priority Targets</div>
    <p style="font-size:11px;color:#94a3b8;margin-bottom:8px;">Always comment on posts from these accounts. One per line with platform checkboxes.</p>
    <div id="priorityTargetsList"></div>
    <div style="display:flex;gap:6px;margin-top:8px;">
      <input type="text" id="newTargetName" placeholder="Target name" style="flex:1;padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;">
      <button type="button" id="addTargetBtn" style="padding:6px 12px;border:1px solid #6366f1;border-radius:6px;background:#f8faff;color:#6366f1;font-size:12px;font-weight:500;cursor:pointer;">Add</button>
    </div>
  </div>
```

- [ ] **Step 6: Move Platforms section into General tab (it stays there)**

The Platforms toggles section stays inside `panel-general`. No change needed.

- [ ] **Step 7: Move Recent History section into General tab (it stays there)**

The Recent History section stays inside `panel-general`. No change needed.

- [ ] **Step 8: Commit**

```bash
git add extension/popup.html
git commit -m "feat: restructure popup with tab bar and per-platform panels"
```

---

### Task 4: Update popup.js for tab switching and per-platform load/save

**Files:**
- Modify: `extension/popup.js`

- [ ] **Step 1: Add tab switching logic and active tab persistence**

Add at the top of the IIFE, after the existing DOM references:

```js
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

  // Restore last active tab
  chrome.storage.local.get('saic_activeTab', function (result) {
    if (result.saic_activeTab) switchTab(result.saic_activeTab);
  });
```

- [ ] **Step 2: Update loadSettings to populate per-platform fields**

Replace the `loadSettings` function body. After the existing General fields loading (provider, api key, models, platforms, contexts), add per-platform loading:

```js
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
        }
      });

      // Load priority targets with platform checkboxes
      renderPriorityTargets(settings.priorityTargets || []);
```

Remove the old engagement threshold loading code and old priority target textarea loading code from the existing `loadSettings`.

- [ ] **Step 3: Populate active context dropdowns after contexts load**

After `contexts = settings.contexts || []; renderContexts();`, add:

```js
      // Populate active context dropdowns per platform
      var ps2 = settings.platformSettings || {};
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
        var activeCtx = (ps2[platform] || {}).activeContext || '';
        ctxSelect.value = activeCtx;
      });
```

- [ ] **Step 4: Update save handler to collect per-platform settings**

Replace the save handler's data object. Keep the General fields, remove old flat fields (`defaultTone`, `autoInterval`, etc.), add `platformSettings`:

```js
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
        interval: parseInt((document.getElementById('ps-' + platform + '-interval') || {}).value, 10) || 60,
        autoSubmit: (document.getElementById('ps-' + platform + '-autoSubmit') || {}).checked !== false,
        contentFilter: (document.getElementById('ps-' + platform + '-contentFilter') || {}).value || 'business',
        stopLimit: parseInt((document.getElementById('ps-' + platform + '-stopLimit') || {}).value, 10) || 0,
        engagementThresholds: thresholds,
        mentionPages: mentionPages
      };
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
```

- [ ] **Step 5: Add priority targets CRUD with per-platform checkboxes**

Replace the old `parseTargetText` function and add new priority target management:

```js
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
        cb.setAttribute('data-target-idx', idx);
        cb.setAttribute('data-platform', p);
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
```

- [ ] **Step 6: Remove old DOM references for deleted elements**

Remove references to elements that no longer exist: `defaultToneSelect`, the old `priorityTargets` textarea, and old flat automation fields (`autoInterval`, `autoStopLimit`, `autoSubmit`, `contentFilter`, `eng-*` threshold inputs).

- [ ] **Step 7: Commit**

```bash
git add extension/popup.js
git commit -m "feat: tab switching, per-platform load/save, priority target checkboxes"
```

---

### Task 5: Update content.js AutomationEngine to read platformSettings

**Files:**
- Modify: `extension/content.js:1144-1165` (loadConfig)
- Modify: `extension/content.js:1396-1427` (isPriorityTarget)
- Modify: `extension/content.js:1429-1456` (classifyAndComment)

- [ ] **Step 1: Update loadConfig to read from platformSettings**

Replace the `loadConfig` method (lines 1144-1165) with:

```js
    loadConfig: function () {
      var settings = savedSettings || {};
      var ps = (settings.platformSettings && settings.platformSettings[platformName]) || {};
      this.config.interval = Math.max(30, Math.min(300, ps.interval || 60));
      this.config.stopLimit = Math.max(0, ps.stopLimit || 0);
      this.config.autoSubmit = ps.autoSubmit !== false;
      this.config.contentFilter = ps.contentFilter || 'business';
      if (ps.engagementThresholds) {
        this.config.engagementThresholds = {};
        this.config.engagementThresholds[platformName] = ps.engagementThresholds;
      } else if (settings.platformSettings && settings.platformSettings[platformName]) {
        this.config.engagementThresholds = {};
        this.config.engagementThresholds[platformName] = DEFAULT_SETTINGS.platformSettings[platformName].engagementThresholds;
      }
      if (settings.priorityTargets && settings.priorityTargets.length) {
        this.config.priorityTargets = settings.priorityTargets;
      }
      if (ps.mentionPages && ps.mentionPages.length) {
        this.config.autoMentionPages = ps.mentionPages;
      }
    },
```

- [ ] **Step 2: Update isPriorityTarget to check target.platforms array**

Replace the `isPriorityTarget` method (lines 1396-1427). Change line 1419 from:

```js
        if (target.platform && target.platform !== platformName) continue;
```

to:

```js
        var tPlatforms = target.platforms || (target.platform ? [target.platform] : ['linkedin', 'facebook', 'x', 'reddit']);
        if (tPlatforms.indexOf(platformName) === -1) continue;
```

This handles both old format (`target.platform` string) and new format (`target.platforms` array).

- [ ] **Step 3: Update classifyAndComment to read per-platform tone, context, mentionPages**

Replace the `classifyAndComment` method (lines 1429-1456) with:

```js
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
      if (!contextInfo) {
        for (var j = 0; j < allContexts.length; j++) {
          if (allContexts[j].isDefault) { contextInfo = allContexts[j].body; break; }
        }
      }

      var task = self.config.contentFilter === 'business' ? 'auto_classify_comment' : 'quick_reply';
      chrome.runtime.sendMessage({
        type: 'generate', data: {
          platform: platformName,
          task: task,
          tone: tone,
          context: context,
          personality: platformConfig.personality,
          contextInfo: contextInfo,
          mentionPages: self.config.autoMentionPages || []
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
```

- [ ] **Step 4: Commit**

```bash
git add extension/content.js
git commit -m "feat: AutomationEngine reads per-platform settings from platformSettings"
```

---

### Task 6: Update content.js manual popover to use per-platform tone

**Files:**
- Modify: `extension/content.js` (tone selector initialization in popover)

- [ ] **Step 1: Find where the popover tone selector is populated and set default from platformSettings**

Find the code in `content.js` where the tone selector dropdown in the popover is created/initialized. Look for the section that creates the tone `<select>` element with options `casual`, `funny`, `informative`. Update the default selection to read from `platformSettings[platformName].tone` instead of `savedSettings.defaultTone`.

The relevant code is in the `openPopover` function where the tone dropdown is populated. Change from:

```js
toneSelect.value = (savedSettings && savedSettings.defaultTone) || 'casual';
```

to:

```js
var ps = (savedSettings && savedSettings.platformSettings && savedSettings.platformSettings[platformName]) || {};
toneSelect.value = ps.tone || 'casual';
```

- [ ] **Step 2: Commit**

```bash
git add extension/content.js
git commit -m "feat: manual popover uses per-platform tone default"
```

---

### Task 7: Test and verify

- [ ] **Step 1: Load extension in Chrome and verify tab switching works**

Open `chrome://extensions`, enable Developer Mode, load `extension/` as unpacked extension. Click the extension icon. Verify:
- Tab bar shows 5 tabs (General, LinkedIn, Facebook, X, Reddit)
- Clicking each tab shows the correct panel
- Last active tab is remembered on popup close/reopen

- [ ] **Step 2: Verify settings load correctly from existing storage**

If settings existed before the change, verify:
- General tab shows existing provider, API key, model, contexts
- Platform tabs show values migrated from old flat settings
- Save works without errors (check chrome.storage in DevTools)

- [ ] **Step 3: Verify per-platform save/load round-trip**

Change tone on LinkedIn tab to "Funny", save, reopen popup, verify LinkedIn tab shows "Funny" while other tabs still show "Casual".

- [ ] **Step 4: Verify automation engine uses per-platform settings**

Navigate to LinkedIn, open DevTools console, start automation. Verify the interval, tone, and content filter match what's configured in the LinkedIn tab of settings.

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during testing"
```
