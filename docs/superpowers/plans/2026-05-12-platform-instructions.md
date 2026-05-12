# Platform-Specific Custom Instructions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-platform instruction presets (checkboxes) and custom instructions (textarea) to each platform tab, integrating them into the AI prompt with token optimization.

**Architecture:** Add `instructionPresets` (array of preset IDs) and `customInstructions` (string) to each platform's settings in `platformSettings`. The popup UI adds 8 checkboxes and a textarea per platform tab. In `buildPrompt()`, enabled presets expand to short directives and are appended after tone/context. Custom text follows, capped at ~250 tokens.

**Tech Stack:** Chrome Extension (manifest v3), vanilla JS, HTML/CSS, Chrome Storage API.

---

## File Structure

| File | Responsibility |
|---|---|
| `extension/background.js` | `INSTRUCTION_PRESETS` map, `DEFAULT_PLATFORM_SETTINGS` update, migration update, `buildPrompt()` update to inject presets + custom text |
| `extension/popup.html` | Checkbox group + textarea in each of the 4 platform panel divs |
| `extension/popup.js` | Load/save `instructionPresets` and `customInstructions` per platform |
| `extension/content.js` | Read presets + custom instructions from platform settings, pass to `generate` message |

---

### Task 1: Add INSTRUCTION_PRESETS map and update DEFAULT_PLATFORM_SETTINGS in background.js

**Files:**
- Modify: `extension/background.js:385-397` (DEFAULT_PLATFORM_SETTINGS)
- Modify: `extension/background.js:271-275` (after TONE_GUIDES, add INSTRUCTION_PRESETS)

- [ ] **Step 1: Add the INSTRUCTION_PRESETS map after TONE_GUIDES (after line 275)**

```javascript
var INSTRUCTION_PRESETS = {
  use_emojis: 'Add relevant emojis to the message.',
  ask_questions: 'End with a relevant question to encourage conversation.',
  keep_short: 'Keep responses to 1-2 sentences maximum.',
  use_hashtags: 'Include 2-3 relevant hashtags.',
  be_empathetic: 'Show empathy toward the original author.',
  include_cta: 'Add a clear call-to-action.',
  avoid_jargon: 'Use plain everyday language, no jargon.',
  professional: 'Maintain a professional, business-appropriate demeanor.'
};
```

- [ ] **Step 2: Update DEFAULT_PLATFORM_SETTINGS to include the new fields (lines 385-397)**

Replace:
```javascript
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
```

With:
```javascript
var DEFAULT_PLATFORM_SETTINGS = {
  tone: 'casual',
  activeContext: '',
  instructionPresets: [],
  customInstructions: '',
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
```

- [ ] **Step 3: Commit**

```bash
git add extension/background.js
git commit -m "feat: add INSTRUCTION_PRESETS map and instruction fields to DEFAULT_PLATFORM_SETTINGS"
```

---

### Task 2: Update migration logic in background.js

**Files:**
- Modify: `extension/background.js:432-452` (migrateSettings function)

- [ ] **Step 1: Add instruction defaults inside the migration loop (after line 441)**

Inside the `migrateSettings` function, after the line `defaults.mentionPages = stored.autoMentionPages || [];` (line 441), the new fields are already covered by DEFAULT_PLATFORM_SETTINGS spread. But we need to ensure existing platformSettings that lack these fields get them.

Add after line 441 (`defaults.mentionPages = ...`):

```javascript
    defaults.instructionPresets = [];
    defaults.customInstructions = '';
```

Then also handle the case where `platformSettings` already exists but lacks these fields. After line 432 (`if (stored.platformSettings) return stored;`), replace the early return with a patching step:

Replace:
```javascript
function migrateSettings(stored) {
  if (stored.platformSettings) return stored;
```

With:
```javascript
function migrateSettings(stored) {
  if (stored.platformSettings) {
    var platforms = ['linkedin', 'facebook', 'x', 'reddit'];
    platforms.forEach(function (p) {
      if (!stored.platformSettings[p]) return;
      if (!stored.platformSettings[p].instructionPresets) {
        stored.platformSettings[p].instructionPresets = [];
      }
      if (stored.platformSettings[p].customInstructions === undefined) {
        stored.platformSettings[p].customInstructions = '';
      }
    });
    return stored;
  }
```

- [ ] **Step 2: Commit**

```bash
git add extension/background.js
git commit -m "feat: update migration to add instruction fields to existing platformSettings"
```

---

### Task 3: Update buildPrompt in background.js to inject presets and custom instructions

**Files:**
- Modify: `extension/background.js:291-381` (buildPrompt function)

- [ ] **Step 1: Update buildPrompt signature and add instruction injection**

The `buildPrompt` function is at line 291. Update its signature to accept `instructionPresets` and `customInstructions`:

Replace:
```javascript
function buildPrompt(platform, task, tone, context, personality, contextInfo, mentionPages) {
```

With:
```javascript
function buildPrompt(platform, task, tone, context, personality, contextInfo, mentionPages, instructionPresets, customInstructions) {
```

Then, after the context injection block (after the line that pushes `'Everything you write must reflect the above profile. Do not ignore any part of it.'`), add the presets + custom instructions injection:

```javascript
  // Inject enabled instruction presets
  if (instructionPresets && instructionPresets.length > 0) {
    systemLines.push('');
    systemLines.push('Writing instructions:');
    instructionPresets.forEach(function (presetId) {
      if (INSTRUCTION_PRESETS[presetId]) {
        systemLines.push('- ' + INSTRUCTION_PRESETS[presetId]);
      }
    });
  }

  // Inject custom instructions (token-limited to ~250 tokens / ~1000 chars)
  if (customInstructions && customInstructions.trim()) {
    var truncated = customInstructions.trim();
    if (truncated.length > 1000) {
      truncated = truncated.substring(0, 1000);
    }
    systemLines.push('');
    systemLines.push('Additional instructions: ' + truncated);
  }
```

- [ ] **Step 2: Update the generate message handler to pass the new fields**

At line 495, the `generate` handler calls `buildPrompt`. Update the call to pass the new fields:

Replace:
```javascript
        var promptResult = buildPrompt(
          data.platform,
          data.task,
          data.tone,
          data.context,
          data.personality,
          data.contextInfo || '',
          data.mentionPages || []
        );
```

With:
```javascript
        var promptResult = buildPrompt(
          data.platform,
          data.task,
          data.tone,
          data.context,
          data.personality,
          data.contextInfo || '',
          data.mentionPages || [],
          data.instructionPresets || [],
          data.customInstructions || ''
        );
```

- [ ] **Step 3: Commit**

```bash
git add extension/background.js
git commit -m "feat: inject instruction presets and custom instructions into buildPrompt"
```

---

### Task 4: Add checkbox group and textarea to popup.html for all 4 platforms

**Files:**
- Modify: `extension/popup.html` (all 4 platform panels)

- [ ] **Step 1: Add instruction presets and custom instructions section to the LinkedIn panel**

Inside the LinkedIn panel (`<div id="panel-linkedin" class="tab-panel">`), after the Active Context `<select>` and before the closing `</div>` of the "Content" section, add:

```html
    <div class="section-title" style="margin-top:12px;">Instruction Presets</div>
    <div class="preset-grid">
      <label class="preset-label"><input type="checkbox" id="ps-linkedin-preset-use_emojis" class="ps-preset"> Use emojis</label>
      <label class="preset-label"><input type="checkbox" id="ps-linkedin-preset-ask_questions" class="ps-preset"> Ask questions</label>
      <label class="preset-label"><input type="checkbox" id="ps-linkedin-preset-keep_short" class="ps-preset"> Keep short</label>
      <label class="preset-label"><input type="checkbox" id="ps-linkedin-preset-use_hashtags" class="ps-preset"> Use hashtags</label>
      <label class="preset-label"><input type="checkbox" id="ps-linkedin-preset-be_empathetic" class="ps-preset"> Be empathetic</label>
      <label class="preset-label"><input type="checkbox" id="ps-linkedin-preset-include_cta" class="ps-preset"> Include CTA</label>
      <label class="preset-label"><input type="checkbox" id="ps-linkedin-preset-avoid_jargon" class="ps-preset"> Avoid jargon</label>
      <label class="preset-label"><input type="checkbox" id="ps-linkedin-preset-professional" class="ps-preset"> Professional</label>
    </div>
    <label for="ps-linkedin-customInstructions" style="margin-top:10px;">Custom Instructions</label>
    <textarea id="ps-linkedin-customInstructions" rows="3" placeholder="e.g. Always mention our product, Never use hashtags..." style="width:100%;padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;resize:vertical;box-sizing:border-box;"></textarea>
```

- [ ] **Step 2: Repeat for the Facebook panel**

Same structure inside `<div id="panel-facebook" class="tab-panel">` after its Active Context select, replacing `linkedin` with `facebook` in all IDs:

```html
    <div class="section-title" style="margin-top:12px;">Instruction Presets</div>
    <div class="preset-grid">
      <label class="preset-label"><input type="checkbox" id="ps-facebook-preset-use_emojis" class="ps-preset"> Use emojis</label>
      <label class="preset-label"><input type="checkbox" id="ps-facebook-preset-ask_questions" class="ps-preset"> Ask questions</label>
      <label class="preset-label"><input type="checkbox" id="ps-facebook-preset-keep_short" class="ps-preset"> Keep short</label>
      <label class="preset-label"><input type="checkbox" id="ps-facebook-preset-use_hashtags" class="ps-preset"> Use hashtags</label>
      <label class="preset-label"><input type="checkbox" id="ps-facebook-preset-be_empathetic" class="ps-preset"> Be empathetic</label>
      <label class="preset-label"><input type="checkbox" id="ps-facebook-preset-include_cta" class="ps-preset"> Include CTA</label>
      <label class="preset-label"><input type="checkbox" id="ps-facebook-preset-avoid_jargon" class="ps-preset"> Avoid jargon</label>
      <label class="preset-label"><input type="checkbox" id="ps-facebook-preset-professional" class="ps-preset"> Professional</label>
    </div>
    <label for="ps-facebook-customInstructions" style="margin-top:10px;">Custom Instructions</label>
    <textarea id="ps-facebook-customInstructions" rows="3" placeholder="e.g. Always mention our product, Never use hashtags..." style="width:100%;padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;resize:vertical;box-sizing:border-box;"></textarea>
```

- [ ] **Step 3: Repeat for the X panel**

Same structure inside `<div id="panel-x" class="tab-panel">`, with `x` in IDs:

```html
    <div class="section-title" style="margin-top:12px;">Instruction Presets</div>
    <div class="preset-grid">
      <label class="preset-label"><input type="checkbox" id="ps-x-preset-use_emojis" class="ps-preset"> Use emojis</label>
      <label class="preset-label"><input type="checkbox" id="ps-x-preset-ask_questions" class="ps-preset"> Ask questions</label>
      <label class="preset-label"><input type="checkbox" id="ps-x-preset-keep_short" class="ps-preset"> Keep short</label>
      <label class="preset-label"><input type="checkbox" id="ps-x-preset-use_hashtags" class="ps-preset"> Use hashtags</label>
      <label class="preset-label"><input type="checkbox" id="ps-x-preset-be_empathetic" class="ps-preset"> Be empathetic</label>
      <label class="preset-label"><input type="checkbox" id="ps-x-preset-include_cta" class="ps-preset"> Include CTA</label>
      <label class="preset-label"><input type="checkbox" id="ps-x-preset-avoid_jargon" class="ps-preset"> Avoid jargon</label>
      <label class="preset-label"><input type="checkbox" id="ps-x-preset-professional" class="ps-preset"> Professional</label>
    </div>
    <label for="ps-x-customInstructions" style="margin-top:10px;">Custom Instructions</label>
    <textarea id="ps-x-customInstructions" rows="3" placeholder="e.g. Always mention our product, Never use hashtags..." style="width:100%;padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;resize:vertical;box-sizing:border-box;"></textarea>
```

- [ ] **Step 4: Repeat for the Reddit panel**

Same structure inside `<div id="panel-reddit" class="tab-panel">`, with `reddit` in IDs:

```html
    <div class="section-title" style="margin-top:12px;">Instruction Presets</div>
    <div class="preset-grid">
      <label class="preset-label"><input type="checkbox" id="ps-reddit-preset-use_emojis" class="ps-preset"> Use emojis</label>
      <label class="preset-label"><input type="checkbox" id="ps-reddit-preset-ask_questions" class="ps-preset"> Ask questions</label>
      <label class="preset-label"><input type="checkbox" id="ps-reddit-preset-keep_short" class="ps-preset"> Keep short</label>
      <label class="preset-label"><input type="checkbox" id="ps-reddit-preset-use_hashtags" class="ps-preset"> Use hashtags</label>
      <label class="preset-label"><input type="checkbox" id="ps-reddit-preset-be_empathetic" class="ps-preset"> Be empathetic</label>
      <label class="preset-label"><input type="checkbox" id="ps-reddit-preset-include_cta" class="ps-preset"> Include CTA</label>
      <label class="preset-label"><input type="checkbox" id="ps-reddit-preset-avoid_jargon" class="ps-preset"> Avoid jargon</label>
      <label class="preset-label"><input type="checkbox" id="ps-reddit-preset-professional" class="ps-preset"> Professional</label>
    </div>
    <label for="ps-reddit-customInstructions" style="margin-top:10px;">Custom Instructions</label>
    <textarea id="ps-reddit-customInstructions" rows="3" placeholder="e.g. Always mention our product, Never use hashtags..." style="width:100%;padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;resize:vertical;box-sizing:border-box;"></textarea>
```

- [ ] **Step 5: Add CSS for the preset grid**

In the `<style>` section of popup.html, add:

```css
.preset-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 12px;
  margin-top: 6px;
}
.preset-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #475569;
  cursor: pointer;
  padding: 2px 0;
}
.preset-label input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: #6366f1;
  cursor: pointer;
}
```

- [ ] **Step 6: Commit**

```bash
git add extension/popup.html
git commit -m "feat: add instruction presets checkboxes and custom instructions textarea to all 4 platform panels"
```

---

### Task 5: Update popup.js to load and save instruction presets and custom instructions

**Files:**
- Modify: `extension/popup.js:233-288` (load platform settings)
- Modify: `extension/popup.js:295-324` (save platform settings)

- [ ] **Step 1: Add preset loading in the loadPlatformSettings loop**

Inside the `['linkedin', 'facebook', 'x', 'reddit'].forEach` block (around line 233), after the mention pages loading code, add:

```javascript
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
```

- [ ] **Step 2: Add preset and custom instructions to the save logic**

Inside the save loop (around line 295), update the `platformSettings[platform] = { ... }` object to include the new fields:

Add after the `mentionPages` field in the platform settings object:

```javascript
    instructionPresets: (function () {
      var PRESET_IDS = ['use_emojis', 'ask_questions', 'keep_short', 'use_hashtags', 'be_empathetic', 'include_cta', 'avoid_jargon', 'professional'];
      var checked = [];
      PRESET_IDS.forEach(function (presetId) {
        var cb = document.getElementById('ps-' + platform + '-preset-' + presetId);
        if (cb && cb.checked) checked.push(presetId);
      });
      return checked;
    })(),
    customInstructions: (document.getElementById('ps-' + platform + '-customInstructions') || {}).value || ''
```

So the full `platformSettings[platform]` object becomes:

```javascript
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
```

- [ ] **Step 3: Commit**

```bash
git add extension/popup.js
git commit -m "feat: load and save instruction presets and custom instructions per platform in popup"
```

---

### Task 6: Update content.js to pass instruction presets and custom instructions to generate messages

**Files:**
- Modify: `extension/content.js:940-950` (handleAction → generate message)
- Modify: `extension/content.js:852-862` (post generate handler → generate message)

- [ ] **Step 1: Read instruction settings from platform settings**

Near the top of the `createFloatingPanel` function (or wherever `savedSettings` is accessed), add a helper to get the current platform's instruction settings. Find where `defaultTone` is read (around line 694):

```javascript
var defaultTone = ((savedSettings && savedSettings.platformSettings && savedSettings.platformSettings[platformName]) || {}).tone || 'casual';
```

Add after it:

```javascript
var platformInstr = ((savedSettings && savedSettings.platformSettings && savedSettings.platformSettings[platformName]) || {});
var instructionPresets = platformInstr.instructionPresets || [];
var customInstructions = platformInstr.customInstructions || '';
```

- [ ] **Step 2: Update the generate message in handleAction (line 940)**

Replace:
```javascript
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
```

With:
```javascript
    chrome.runtime.sendMessage({
      type: 'generate',
      data: {
        platform: platformName,
        task: task,
        tone: tone,
        context: context,
        personality: platformConfig.personality,
        contextInfo: contextInfo,
        instructionPresets: instructionPresets,
        customInstructions: customInstructions
      }
    }, function (response) {
```

- [ ] **Step 3: Update the generate message in post mode (line 852)**

Replace:
```javascript
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
```

With:
```javascript
      chrome.runtime.sendMessage({
        type: 'generate',
        data: {
          platform: platformName,
          task: 'post',
          tone: toneSelect.value,
          context: postContext,
          personality: platformConfig.personality,
          contextInfo: selectedCtxTexts.join('\n'),
          instructionPresets: instructionPresets,
          customInstructions: customInstructions
        }
      }, function (response) {
```

- [ ] **Step 4: Commit**

```bash
git add extension/content.js
git commit -m "feat: pass instruction presets and custom instructions from content.js to generate messages"
```

---

### Task 7: Manual verification

- [ ] **Step 1: Load the extension in Chrome**

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click "Load unpacked" and select the `extension/` folder

- [ ] **Step 2: Verify popup UI**

1. Click the extension icon
2. Switch to each platform tab (LinkedIn, Facebook, X, Reddit)
3. Confirm 8 checkboxes appear under "Instruction Presets"
4. Confirm textarea appears under "Custom Instructions"
5. Toggle some checkboxes on, type in the textarea, click Save
6. Reopen popup — confirm checkboxes and text persist

- [ ] **Step 3: Verify AI generation includes instructions**

1. Navigate to a supported platform (e.g. LinkedIn)
2. Double-click a comment field to open the floating panel
3. Generate a reply
4. Inspect the browser console for the generate message — confirm `instructionPresets` and `customInstructions` are included in the data

- [ ] **Step 4: Verify migration works**

1. If you have existing settings without the new fields, reload the extension
2. Open popup — confirm no errors, new fields show defaults (empty)

- [ ] **Step 5: Commit final state if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during manual verification"
```
