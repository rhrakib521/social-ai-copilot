# Social AI Copilot — Setup Guide

## Install the Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **"Load unpacked"**
4. Select the `extension/` folder from this project
5. The extension icon appears in your toolbar

## Add Your API Key

1. Click the extension icon in the Chrome toolbar
2. Select your AI provider (OpenAI or GLM)
3. Paste your API key
4. Click **Save Settings**

## Use It

1. Navigate to any supported platform (LinkedIn, Facebook, X, Reddit)
2. Click on any comment box, post input, or editable field
3. A purple **AI** button appears near the field
4. Click it to open the popover
5. Choose an action (Reply, Comment, New Post, Rewrite, Expand, Summarize)
6. Pick a tone (Professional, Casual, Witty, Direct)
7. Click the action — AI generates text
8. Edit if needed, then click **Insert**
9. Keyboard shortcut: **Ctrl+Shift+A** (Mac: **Cmd+Shift+A**)

## Project Structure

```
extension/          ← Load this folder into Chrome
  manifest.json     ← MV3 config
  background.js     ← Service worker (API calls, shortcuts)
  content.js        ← Injected into social platforms
  styles.css        ← UI styles
  popup.html/js     ← Settings panel
  icons/            ← Extension icons

core/               ← Reusable modules (for tests, other builds)
  aiProvider.js     ← Provider registry
  promptBuilder.js  ← Prompt construction
  contextExtractor.js ← DOM context extraction
  uiManager.js      ← UI component factory
  providers/        ← OpenAI, GLM, Backend adapters

utils/              ← Stateless helpers
  storage.js        ← chrome.storage wrapper
  platform.js       ← Platform detection + selectors
  dom.js            ← Safe text insertion
```

## Switching Providers

- **OpenAI**: Paste your OpenAI API key (sk-...)
- **GLM**: Paste your Zhipu AI API key
- **Backend Proxy**: Set up your own server that accepts `{ messages, max_tokens, temperature }` and returns `{ text: "..." }`, then paste your auth token

## Troubleshooting

- **No AI button appears**: Make sure the platform is enabled in settings
- **"API key not configured"**: Open the popup and save your key
- **Service worker errors**: Go to chrome://extensions → click "service worker" link to see logs
- **Content not detected**: Some pages load dynamically — click into the field again
