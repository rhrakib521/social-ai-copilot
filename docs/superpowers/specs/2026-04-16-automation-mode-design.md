# Automation Mode Design

**Date:** 2026-04-16
**Status:** Approved
**Approach:** Content Script Loop (Approach A)

## Overview

Add a fully automated commenting mode to Social AI Copilot that scrolls through social media feeds and posts AI-generated quick comments on uncommented posts at a configurable interval (default 60 seconds). Works across LinkedIn, Facebook, X/Twitter, and Reddit.

## Architecture

### Approach: Content Script Loop

All automation logic lives in `content.js` as a new `AutomationEngine` object. The background service worker is only used for AI generation (existing flow). No new permissions required.

**Loop cycle:**
1. Find next uncommented post in the feed
2. Extract post context via existing `extractContext()`
3. Send to `background.js` for AI quick_reply generation
4. Simulate human-like typing into the comment field
5. Submit the comment
6. Wait for the configured interval
7. Human-like scroll to find the next post
8. Repeat until stopped or auto-stop limit reached

State is in-memory only. Automation stops when the tab closes or the user toggles it off.

## UI: Floating Control Panel

A small floating panel fixed to the bottom-right corner of the page.

### Collapsed State
- Small circular button (40x40px) with a play/stop icon
- Indigo/purple accent matching existing popover design
- Draggable position

### Expanded State (on click)
- **Toggle switch** - master on/off for automation
- **Status line** - "Idle" / "Running" / "Paused" / "Stopped (limit reached)"
- **Stats row** - Comments made (e.g. "5/20") and time elapsed
- **Next action timer** - countdown to next comment (e.g. "Next in 42s")
- **Settings button** (gear icon) - opens mini-config:
  - Interval slider (30s-300s, default 60s)
  - Auto-stop limit (0 = unlimited, or set a number)
  - Platform indicator (auto-detected, read-only)

### Styling
- Consistent with existing popover (indigo/purple accent, #6366f1)
- Font sizes 10-12px matching current extension UI
- Smooth transitions between collapsed/expanded states
- Z-index above page content but below the existing popover

## Post Detection

Platform-specific selectors for finding posts, comment buttons, and reply fields:

| Platform | Post Container | Comment Button | Reply Field |
|----------|---------------|----------------|-------------|
| LinkedIn | `.feed-shared-update-v2` | `button[aria-label*="Comment"]` | `.ql-editor[contenteditable="true"]` |
| Facebook | `div[data-pagelet*="feed"]` | `[aria-label*="Comment"]` | `[contenteditable="true"][role="textbox"]` |
| X/Twitter | `article[data-testid="tweet"]` | `[data-testid="reply"]` | `[data-testid="tweetTextarea"]` |
| Reddit | `.Post` or `[data-testid="post-container"]` | Comment toggle button | `textarea[name="text"]` |

Selectors will be added to the existing `PLATFORMS` config object with new `postSelector`, `commentButtonSelector`, and `replyFieldSelector` properties.

## Already-Commented Check

After finding a post, scan its comment thread for the current user's identifier. If the user has already commented, skip to the next post. Detection method varies by platform:

- **LinkedIn/Facebook**: Check comment section for the user's profile name
- **X/Twitter**: Check replies for the user's handle
- **Reddit**: Check comment thread for the user's username

Maintain a `Set` of processed post identifiers (DOM-based fingerprint) to avoid re-processing posts even if the user-name check fails.

## Comment Submission Flow

1. Click the post's comment/reply button to open the input field
2. Wait for the field to appear (100-500ms delay, with retry up to 2s)
3. Focus the field
4. Simulate typing the AI-generated text character by character
5. Find and click the submit button
6. Wait for submission to complete (watch for the comment in the thread, up to 3s)

**Error handling:** If any step fails, log the error, skip that post, and move to the next one after a 5-10s delay. Continue the loop without stopping.

## Human-Like Behavior

### Scrolling
- **Speed:** Random 200-600 pixels per second with micro-stops
- **Distance:** Variable 1-3 viewport heights between posts
- **Random pauses:** 0.5-2 second pauses mid-scroll to simulate reading
- **Implementation:** `requestAnimationFrame` loop with variable step sizes

### Typing
- **Character delay:** Random 30-80ms between characters
- **Natural feel:** Occasional 100-200ms pause mid-word (10% chance per character)

### Reading Simulation
- **Post read delay:** 3-8 second pause after scrolling to a post before commenting
- **Session rhythm:** Every 5-8 comments, a longer 5-15 second pause

All randomness uses `Math.random()` ranges. No external dependencies.

## AI Generation

Uses the existing `quick_reply` task type with:
- **Tone:** Default tone from extension settings
- **Context:** Default context profile (if set in settings)
- **Token limit:** 150 tokens (existing `quick_reply` limit)
- **Task instructions:** Existing quick_reply prompt ("Write a short, natural 2-3 line comment...")

Reuses the existing `chrome.runtime.sendMessage({ type: 'generate', ... })` flow. No changes needed in `background.js` for AI generation.

## Popup Settings Integration

New "Automation" section in `popup.html` after the existing "Contexts" section:

- **Default interval** - numeric input (seconds), default 60, min 30, max 300
- **Default auto-stop limit** - numeric input, 0 = unlimited
- **Start minimized** - checkbox (on by default, starts as collapsed floating button)

Stored in `chrome.storage.local` under the existing settings object with new keys:
- `autoInterval` (number, default 60)
- `autoStopLimit` (number, default 0)
- `autoStartMinimized` (boolean, default true)

## Safety Limits

- **Minimum interval:** 30 seconds (hardcoded floor, cannot be lowered)
- **Maximum interval:** 300 seconds (5 min, hardcoded ceiling)
- **Auto-stop:** Stops at configured limit or when no uncommented posts found after scanning 10+ posts
- **Console logging:** All automation actions logged to `console.log` with `[SAIC-Auto]` prefix for debugging
- **Tab visibility:** Continues running even if the tab loses focus, but pauses if the tab is hidden (uses `document.visibilityState`)

## Files to Modify

| File | Changes |
|------|---------|
| `content.js` | Add `AutomationEngine` object (~300 lines): floating panel UI, loop logic, scroll/typing simulation, post detection, submission flow |
| `background.js` | Add `autoInterval`, `autoStopLimit`, `autoStartMinimized` to `DEFAULT_SETTINGS` |
| `popup.html` | Add Automation settings section with interval/limit inputs |
| `popup.js` | Add automation settings load/save logic |
| `styles.css` | Add floating panel styles (~80 lines) |
| `manifest.json` | No changes needed (existing permissions sufficient) |

## AutomationEngine Structure

```
AutomationEngine = {
  state: 'idle' | 'running' | 'paused' | 'stopped',
  config: { interval, stopLimit, ... },
  stats: { commentsMade, startTime, ... },

  // UI
  createPanel()
  togglePanel()
  updateStatus()

  // Core loop
  start()
  stop()
  pause()
  resume()
  runCycle()

  // Feed interaction
  findNextPost()
  isAlreadyCommented()
  clickCommentButton()
  typeComment(text)
  submitComment()

  // Scrolling
  humanScroll(targetY)
  scrollToPost(postEl)

  // Settings
  loadConfig()
}
```
