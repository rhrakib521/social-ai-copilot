# Social AI Copilot — Design Spec

**Date:** 2026-04-03
**Status:** Approved

## Overview

A Chrome extension (Manifest V3) that acts as an AI writing copilot inside LinkedIn, Facebook, X/Twitter, and Reddit. Users generate comments, rewrite text, create posts, and quote content — all directly in the platform UI via a floating popover.

## Architecture: Flat Module

Self-contained ES modules with clear single responsibilities. No classes, no inheritance — functions and exports. Content scripts never make API calls; all LLM traffic routes through the background service worker.

## File Structure

```
extension/
  manifest.json          — MV3 config, permissions, content script registrations
  background.js          — Service worker: API routing, provider dispatch, settings
  content.js             — Entry point: DOM scanning, observer, popover lifecycle
  styles.css             — All injected UI styles (trigger, popover, animations)
  popup.html             — Extension popup: settings panel UI
  popup.js               — Settings logic: API keys, provider, tone, platform toggles

core/
  aiProvider.js          — Provider registry + unified call interface
    exports: registerProvider(), callProvider(providerId, messages, options)
  providers/
    openai.js            — OpenAI/GPT-3.5 adapter
    glm.js               — GLM 5.1 adapter
    backendProxy.js      — Backend service adapter (for SaaS mode)
  promptBuilder.js       — Builds LLM prompts from context
    exports: buildPrompt({ platform, task, tone, context })
  contextExtractor.js    — Pulls post/author/comment context from DOM
    exports: extractContext(activeElement) → { postText, author, nearbyComments, selectedText }
    exports: pickPost(platform) — picker mode for user to select a different post
  uiManager.js           — Creates/manages trigger button + popover DOM
    exports: createTrigger(field), showPopover(trigger, actions), hidePopover(), insertText(field, text)

utils/
  dom.js                 — Safe DOM helpers: insert, cursor, selection
  platform.js            — Platform detection + platform-specific selectors
    exports: detectPlatform(url) → 'linkedin' | 'facebook' | 'x' | 'reddit' | null
    exports: getFieldSelectors(platform) → { editableFields, postContainers, commentBoxes }
  storage.js             — chrome.storage wrapper with defaults
    exports: getSettings(), saveSettings(partial), getHistory(), saveHistory(entry)
```

### Module Boundary Rules

- `content.js` imports from `core/` and `utils/` — it's the orchestrator
- `background.js` imports from `core/aiProvider.js` only — it's the API gateway
- `core/` modules never import each other — they're pure functions
- `utils/` are stateless helpers used by everyone
- `popup.js` only talks to `utils/storage.js` and `background.js` (via messages)

## Data Flow

1. **User clicks AI button** — content.js detects click, shows popover
2. **User picks action** — e.g. "Generate Comment"
3. **content.js collects context** — contextExtractor.js grabs post text, author, selected text
4. **promptBuilder.js builds prompt** — merges platform personality + task + tone + context
5. **chrome.runtime.sendMessage → background.js** — background selects provider, makes API call
6. **Response → popover preview** — user can edit the generated text
7. **"Insert" button → text into input field** — dom.js safely injects text, preserves cursor

## Post Selection & Context

### Auto-detection (primary)
When the AI button is clicked, `contextExtractor.js` traverses up the DOM from the input field to find the nearest post container using platform-specific selectors.

### Highlight-to-select (secondary)
If the user has text selected on the page, that selection becomes the primary context. Overrides or supplements auto-detected post.

### Context preview strip
The popover shows a compact preview of what it's replying to (author + truncated post text). A "Change selection" link enters picker mode: the user clicks any post on the page to override context.

## Platform Detection

### Two-layer approach
1. **URL matching** — runs once on page load. `linkedin.com` → `'linkedin'`, `x.com` → `'x'`, etc.
2. **DOM confirmation** — MutationObserver confirms editable fields exist using platform-specific selectors

### Platform configs are data objects
Each platform has a config with: `editableFields` (selector array), `postContainers` (selector array), `authorSelector`, `personality` string. No if/else chains — just config lookup by platform ID.

Supported platforms:
- `linkedin.com` → insightful, professional, not corporate
- `facebook.com` → conversational, natural
- `twitter.com` / `x.com` → short, sharp, punchy
- `reddit.com` → honest, slightly informal, value-driven, not salesy

## Prompt Engine

### System prompt (always included)
"You are a human-like social media writer. Write naturally. Avoid robotic phrasing like 'Great post!' or 'I completely agree.' Add perspective, not summary."

### Dynamic layers merged on top
1. **Platform personality** — "You're writing for LinkedIn. Be insightful, professional..."
2. **Task instruction** — Comment: add perspective. Rewrite: improve clarity. Post: structured and engaging. Quote: opinionated and short.
3. **Tone modifier** — Professional, Casual, Witty, or Direct
4. **Context payload** — Post text, author, selected text

### Output rules (appended to every prompt)
- No hashtags unless explicitly requested
- No emojis unless casual tone
- Slightly imperfect human tone
- Never use filler phrases like "As a..." or "In my opinion..."

## UI Components

### AI Trigger Button
28x28px gradient badge (pill or circle). Appears inside/beside detected editable fields. Fades in with CSS transition. Hover: slight scale-up + glow.

### AI Popover Panel
Anchored near the trigger button. Three states:
1. **Action selection** — 4 action buttons + tone chips + context preview strip
2. **Loading** — "Thinking..." with animated dots
3. **Result** — Editable textarea with Insert / Regenerate / Close buttons

Dismisses on outside click.

### Settings Panel (Popup)
Accessed from Chrome toolbar. Contains:
- LLM provider dropdown
- API key field (masked)
- Default tone selector (chips)
- Platform toggles (on/off per platform)
- Auth mode switch (user key vs backend)
- Generation history list

## Dual API Mode

### Mode A: User's own key
- User enters API key in settings
- Key stored in `chrome.storage.local`
- background.js reads key, calls LLM directly via `fetch()`

### Mode B: Backend proxy
- User signs up / logs in via popup
- Auth token stored in `chrome.storage.local`
- background.js calls your backend API with token
- Backend proxies to LLM, returns result

### Routing
Settings include `authMode`: `'user_key'` or `'backend'`. background.js checks this on every request and dispatches to the appropriate provider adapter. If `'user_key'` but no key is saved, shows notification to open settings.

## Provider Abstraction

Each provider (`openai.js`, `glm.js`, `backendProxy.js`) exports:
```js
export async function generate(messages, options) → string
```

Unified input format, normalized output. Provider registry in `aiProvider.js` maps provider IDs to adapter modules.

## Security

- API keys never touch the DOM — stored in `chrome.storage.local`, read only by background.js
- All API calls from background service worker only — content scripts use `chrome.runtime.sendMessage`
- No `innerHTML` with user data — all UI via `document.createElement()`
- Minimal manifest permissions: `storage`, `activeTab`, host permissions for 4 platforms only
- No auto-submit — extension only inserts text, never triggers form submission

## Performance

- Debounced DOM scanning (MutationObserver with debounce)
- Platform config loaded once per page
- No unnecessary re-renders — popover only re-renders on state change
- Lazy-load provider adapters — only import the active provider

## Bonus Features (v1)

- **Keyboard shortcut:** `Ctrl/Cmd + Shift + A` opens popover on nearest editable field via `chrome.commands`
- **Generation history:** Each output saved to `chrome.storage.local` with timestamp, platform, action type. Accessible from popup. "Reuse" inserts previous output. Capped at 100 entries (FIFO).
- **Tone switch in popover:** Tone chips in the popover. Clicking a different tone re-runs generation.
