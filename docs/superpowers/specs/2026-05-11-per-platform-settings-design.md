# Per-Platform Settings Design

## Problem

The Social AI Copilot extension treats all 4 platforms (LinkedIn, Facebook, X, Reddit) the same way — one global set of tone, interval, content filter, auto-submit, engagement thresholds, mention pages, and stop limit settings. In reality, each platform has different feed dynamics, content norms, and engagement patterns that demand separate configuration.

## Decision

Split all automation and content settings into per-platform overrides, controlled via a tabbed UI in the popup.

## Data Model

Settings stored in `chrome.storage.local` under `socialAiCopilot_settings`:

```js
{
  // ── Shared (General tab) ──
  provider: 'openai',
  apiKey: '',
  openaiModel: 'gpt-4.1-mini',
  glmModel: 'glm-5.1',
  geminiModel: 'gemini-2.5-flash',
  deepseekModel: 'deepseek-chat',
  qwenModel: 'qwen-plus',
  backendToken: '',
  authMode: 'user_key',
  contexts: [],                              // [{id, name, body, isDefault}]
  priorityTargets: [],                       // [{name, platforms:['linkedin','x'], type}]
  platforms: { linkedin:true, facebook:true, x:true, reddit:true },

  // ── Per-platform overrides ──
  platformSettings: {
    linkedin: {
      tone: 'casual',
      activeContext: '',                      // context profile ID or ''
      interval: 60,
      autoSubmit: true,
      contentFilter: 'business',
      stopLimit: 0,
      engagementThresholds: { minReactions:50, minComments:10 },
      mentionPages: []
    },
    facebook: {
      tone: 'casual',
      activeContext: '',
      interval: 60,
      autoSubmit: true,
      contentFilter: 'business',
      stopLimit: 0,
      engagementThresholds: { minReactions:30, minComments:5 },
      mentionPages: []
    },
    x: {
      tone: 'casual',
      activeContext: '',
      interval: 60,
      autoSubmit: true,
      contentFilter: 'business',
      stopLimit: 0,
      engagementThresholds: { minLikes:100, minRetweets:20 },
      mentionPages: []
    },
    reddit: {
      tone: 'casual',
      activeContext: '',
      interval: 60,
      autoSubmit: true,
      contentFilter: 'business',
      stopLimit: 0,
      engagementThresholds: { minUpvotes:50, minComments:10 },
      mentionPages: []
    }
  }
}
```

Old flat keys (`defaultTone`, `autoInterval`, `autoSubmit`, `contentFilter`, `autoStopLimit`, `engagementThresholds`, `autoMentionPages`) are no longer read at runtime but kept in storage for backward compatibility.

### Migration

One-time migration in `getSettings()`: if `platformSettings` key is missing from stored settings, build it from old flat values:
- `defaultTone` → all platform `tone` values
- `autoInterval` → all platform `interval` values
- `autoSubmit` → all platform `autoSubmit` values
- `contentFilter` → all platform `contentFilter` values
- `autoStopLimit` → all platform `stopLimit` values
- `engagementThresholds.linkedin` → `platformSettings.linkedin.engagementThresholds` (same for others)
- `autoMentionPages` → all platform `mentionPages` values

## UI Layout

### Tab Bar

Added below the header, above all settings content. 5 tabs: General, LinkedIn, Facebook, X, Reddit.

```
┌─────────────────────────────────────┐
│  ★  Social AI Copilot              │  ← existing header
├─────────────────────────────────────┤
│ General │ LinkedIn │ Facebook │ X │ Reddit │  ← tab bar
├─────────────────────────────────────┤
│  [active tab panel content]         │
│                                     │
│  [Save]                             │
│  Ctrl+Shift+A                       │
└─────────────────────────────────────┘
```

- Active tab has colored bottom border (purple gradient)
- Last selected tab persisted in `chrome.storage.local` key `saic_activeTab`
- Popup height increased from 500px to ~580px

### General Tab

- Provider & API key section (unchanged)
- Model selection (unchanged)
- Context profiles section (unchanged)
- Priority targets: each target gets 4 checkboxes for platform selection (replaces textarea)
- Platform enable/disable toggles
- Recent History section

### Platform Tabs (LinkedIn / Facebook / X / Reddit)

Each platform tab contains the same field layout:

| Field | Control | Notes |
|-------|---------|-------|
| Default tone | Dropdown (casual/funny/informative) | Per-platform override |
| Active context | Dropdown (from shared contexts + "None") | Per-platform selection |
| Auto-submit | Toggle switch | |
| Interval | Slider (30-300s) | |
| Stop limit | Number input (0=unlimited) | |
| Content filter | Dropdown (business/all) | |
| Engagement thresholds | Number inputs | Platform-specific: LinkedIn/FB=react/comments, X=likes/RTs, Reddit=upvotes/comments |
| Mention pages | Textarea (one per line) | Per-platform list |

HTML structure uses `data-tab` attributes and show/hide panels:

```html
<div class="tab-bar">
  <button class="tab active" data-tab="general">General</button>
  <button class="tab" data-tab="linkedin">LinkedIn</button>
  <button class="tab" data-tab="facebook">Facebook</button>
  <button class="tab" data-tab="x">X</button>
  <button class="tab" data-tab="reddit">Reddit</button>
</div>
<div id="panel-general" class="tab-panel active"><!-- ... --></div>
<div id="panel-linkedin" class="tab-panel"><!-- ... --></div>
<div id="panel-facebook" class="tab-panel"><!-- ... --></div>
<div id="panel-x" class="tab-panel"><!-- ... --></div>
<div id="panel-reddit" class="tab-panel"><!-- ... --></div>
```

## File Changes

### `extension/popup.html`
- Add tab bar HTML after header
- Restructure body into 5 tab panels
- Move existing General settings into `panel-general`
- Create 4 platform panels with identical field layouts
- Priority targets UI: checkboxes per platform per target row
- Increase popup height
- Add tab-related CSS (tab bar, active state, panel visibility)

### `extension/popup.js`
- Tab switching logic with `data-tab` click handlers
- Persist active tab to `chrome.storage.local`
- `loadSettings()`: populate General fields + all 4 platform panels from `platformSettings`
- `saveSettings()`: collect General fields + all platform overrides into one object
- On tab switch, no auto-save — Save button saves everything
- Priority target CRUD with per-platform checkboxes

### `extension/background.js`
- `DEFAULT_SETTINGS`: add `platformSettings` object, remove deprecated flat keys
- `getSettings()`: migration logic to build `platformSettings` from old flat values
- `buildPrompt()`: read `platformSettings[platform]` for tone, activeContext, contentFilter, mentionPages
- `auto_classify_comment` task: read per-platform tone and context
- `saveSettings` handler: accept `platformSettings` structure

### `extension/content.js`
- `AutomationEngine`: read all config from `platformSettings[currentPlatform]` instead of global
- Priority target matching: check `target.platforms` array instead of `target.platform` field
- `savedSettings` access: go through `platformSettings[platformName]` for interval, autoSubmit, stopLimit, contentFilter, thresholds, mentionPages
- Mention pages: read from `platformSettings[platformName].mentionPages`

## Scope

This spec covers the settings restructure and UI only. No changes to:
- Automation engine logic (scoring, classification, submission flow)
- Platform selectors in `PLATFORMS` config
- AI provider implementations
- Web Worker background timer
- Anti-detection features (mouse movement, typing simulation)
