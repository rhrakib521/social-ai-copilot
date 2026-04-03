# Social AI Copilot — Implementation Plan

> **Date:** 2026-04-03
> **Project:** Social AI Copilot Chrome Extension (Manifest V3)
> **Stack:** Vanilla JavaScript, ES Modules, Chrome Extension APIs

---

## File Structure

```
extension/
  manifest.json
  background.js
  content.js
  styles.css
  popup.html
  popup.js
core/
  aiProvider.js
  providers/
    openai.js
    glm.js
    backendProxy.js
  promptBuilder.js
  contextExtractor.js
  uiManager.js
utils/
  dom.js
  platform.js
  storage.js
```

All paths are relative to `D:\Coding\Social Media Agent\`.

---

## Task 1: Project Scaffolding — manifest.json and Directory Structure

Create the directory structure and the Chrome Extension manifest.

- [ ] Create all directories: `extension/`, `core/`, `core/providers/`, `utils/`
- [ ] Write `extension/manifest.json`

```json
{
  "manifest_version": 3,
  "name": "Social AI Copilot",
  "version": "1.0.0",
  "description": "AI-powered writing assistant for LinkedIn, Facebook, X/Twitter, and Reddit.",
  "permissions": [
    "storage",
    "activeTab"
  ],
  "host_permissions": [
    "https://www.linkedin.com/*",
    "https://www.facebook.com/*",
    "https://x.com/*",
    "https://twitter.com/*",
    "https://www.reddit.com/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": [
        "https://www.linkedin.com/*",
        "https://www.facebook.com/*",
        "https://x.com/*",
        "https://twitter.com/*",
        "https://www.reddit.com/*"
      ],
      "js": ["content.js"],
      "css": ["styles.css"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "commands": {
    "trigger-ai": {
      "suggested_key": {
        "default": "Ctrl+Shift+A",
        "mac": "Command+Shift+A"
      },
      "description": "Trigger AI Copilot on the active field"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "web_accessible_resources": [
    {
      "resources": ["styles.css"],
      "matches": [
        "https://www.linkedin.com/*",
        "https://www.facebook.com/*",
        "https://x.com/*",
        "https://twitter.com/*",
        "https://www.reddit.com/*"
      ]
    }
  ]
}
```

- [ ] Create a placeholder `icons/` directory under `extension/` with a note to add 16x16, 48x48, and 128x128 PNG icons later.

## Task 2: utils/storage.js — Settings and History Persistence

Implements all storage operations using `chrome.storage.local`.

- [ ] Write `utils/storage.js`

```javascript
// utils/storage.js
// Provides typed access to chrome.storage.local for settings and generation history.

const SETTINGS_KEY = 'socialAiCopilot_settings';
const HISTORY_KEY = 'socialAiCopilot_history';
const MAX_HISTORY = 100;

const DEFAULT_SETTINGS = {
  provider: 'openai',       // 'openai' | 'glm' | 'backend'
  authMode: 'user_key',     // 'user_key' | 'backend'
  apiKey: '',
  backendToken: '',
  defaultTone: 'professional', // 'professional' | 'casual' | 'witty' | 'direct'
  platforms: {
    linkedin: true,
    facebook: true,
    x: true,
    reddit: true
  }
};

/**
 * Read the full settings object from chrome.storage.local.
 * Returns a copy merged with DEFAULT_SETTINGS so every field is always present.
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(SETTINGS_KEY, (result) => {
      const stored = result[SETTINGS_KEY] || {};
      resolve({ ...DEFAULT_SETTINGS, ...stored, platforms: { ...DEFAULT_SETTINGS.platforms, ...(stored.platforms || {}) } });
    });
  });
}

/**
 * Merge partial settings into the stored settings and persist.
 * @param {Partial<typeof DEFAULT_SETTINGS>} partial
 * @returns {Promise<void>}
 */
export async function saveSettings(partial) {
  const current = await getSettings();
  const merged = { ...current, ...partial, platforms: { ...current.platforms, ...(partial.platforms || {}) } };
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SETTINGS_KEY]: merged }, resolve);
  });
}

/**
 * Retrieve the full generation history array (newest first).
 * Each entry shape: { id: string, timestamp: number, platform: string, task: string, tone: string, input: string, output: string }
 * @returns {Promise<Array>}
 */
export async function getHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get(HISTORY_KEY, (result) => {
      resolve(result[HISTORY_KEY] || []);
    });
  });
}

/**
 * Append a new entry to the history. If the history exceeds MAX_HISTORY (100),
 * the oldest entries are removed (FIFO).
 * @param {{ platform: string, task: string, tone: string, input: string, output: string }} entry
 * @returns {Promise<void>}
 */
export async function saveHistory(entry) {
  const history = await getHistory();
  const newEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    ...entry
  };
  history.unshift(newEntry);
  if (history.length > MAX_HISTORY) {
    history.length = MAX_HISTORY;
  }
  return new Promise((resolve) => {
    chrome.storage.local.set({ [HISTORY_KEY]: history }, resolve);
  });
}
```

## Task 3: utils/platform.js — Platform Detection and Selectors

Detects the current social platform from the page URL and provides DOM selectors.

- [ ] Write `utils/platform.js`

```javascript
// utils/platform.js
// Detects which social platform the user is on and returns its DOM configuration.

/** @typedef {{ editableFields: string[], postContainers: string[], authorSelector: string, personality: string }} PlatformConfig */

const PLATFORMS = {
  linkedin: {
    editableFields: [
      '.ql-editor[contenteditable="true"]',
      '.msg-form__contenteditable[contenteditable="true"]',
      '.comments-comment-texteditor[contenteditable="true"]',
      '[data-placeholder*="post"]',
      '[aria-label*="Post"]',
      '[aria-label*="comment"]',
      '[aria-label*="message"]'
    ],
    postContainers: [
      '.feed-shared-update-v2',
      '.comments-comments-list__comment-item',
      '.msg-s-message-listevent'
    ],
    authorSelector: '.update-components-actor__title span[dir="ltr"], .comments-post-meta__actor span[dir="ltr"]',
    personality: 'You are writing for LinkedIn. The tone should be professional and thought-leadership oriented. Use industry-relevant language. Keep content polished and suitable for a business network.'
  },

  facebook: {
    editableFields: [
      '[aria-label*="Post"][role="textbox"]',
      '[aria-label*="comment"][role="textbox"]',
      '[data-text="true"]',
      '[contenteditable="true"][aria-label*="Write"]'
    ],
    postContainers: [
      '[data-pagelet*="feed"] [role="article"]',
      '[aria-label*="Comment"]'
    ],
    authorSelector: 'a[role="link"] span a span, h4 a span',
    personality: 'You are writing for Facebook. The tone should be friendly, conversational, and engaging. Content should feel natural and encourage interaction.'
  },

  x: {
    editableFields: [
      '[data-testid="tweetTextarea_0"]',
      '[data-testid="tweetTextarea_1"]',
      '.public-DraftEditor-content[contenteditable="true"]',
      '[placeholder*="Tweet"]',
      '[aria-label*="Tweet text"]'
    ],
    postContainers: [
      '[data-testid="tweet"]',
      'article[data-testid="tweet"]'
    ],
    authorSelector: '[data-testid="User-Name"] a span',
    personality: 'You are writing for X (Twitter). Be concise, punchy, and impactful. Use hashtags strategically. Respect the character-limited culture even when writing longer posts.'
  },

  reddit: {
    editableFields: [
      '.public-DraftEditor-content[contenteditable="true"]',
      'textarea[name="text"]',
      'textarea#comment-textarea',
      '[contenteditable="true"]',
      '.md textarea'
    ],
    postContainers: [
      '.thing.link',
      '.thing.comment',
      '[data-testid="post-container"]',
      '.Comment'
    ],
    authorSelector: '.author, a[data-testid="post_author_link"], [data-testid="comment_author_link"]',
    personality: 'You are writing for Reddit. Be authentic, knowledgeable, and community-aware. Match the subreddit culture. Avoid overly marketing language. Use proper formatting with Markdown.'
  }
};

/**
 * Detect which social platform the current page is on.
 * @param {string} url - The full URL of the current tab.
 * @returns {'linkedin'|'facebook'|'x'|'reddit'|null}
 */
export function detectPlatform(url) {
  if (!url) return null;
  const hostname = new URL(url).hostname;
  if (hostname.includes('linkedin.com')) return 'linkedin';
  if (hostname.includes('facebook.com')) return 'facebook';
  if (hostname.includes('x.com') || hostname.includes('twitter.com')) return 'x';
  if (hostname.includes('reddit.com')) return 'reddit';
  return null;
}

/**
 * Get the full platform configuration object.
 * @param {'linkedin'|'facebook'|'x'|'reddit'} platform
 * @returns {PlatformConfig|null}
 */
export function getFieldSelectors(platform) {
  const config = PLATFORMS[platform];
  if (!config) return null;
  return {
    editableFields: config.editableFields,
    postContainers: config.postContainers,
    authorSelector: config.authorSelector,
    personality: config.personality
  };
}
```

## Task 4: utils/dom.js — DOM Manipulation Utilities

Provides safe DOM helpers for text insertion and selection retrieval.

- [ ] Write `utils/dom.js`

```javascript
// utils/dom.js
// Safe DOM utilities for text insertion and selection reading.

/**
 * Insert text at the current cursor position inside a contenteditable element
 * or textarea. Moves the cursor to the end of the inserted text.
 * Uses document.execCommand to maintain the native undo stack where possible.
 * Falls back to manual range manipulation for contenteditable elements.
 * @param {HTMLElement} field - The target editable element.
 * @param {string} text - The text to insert.
 */
export function insertTextAtCursor(field, text) {
  field.focus();

  // Handle <textarea> and <input> elements
  if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const value = field.value;
    field.value = value.substring(0, start) + text + value.substring(end);
    field.selectionStart = field.selectionEnd = start + text.length;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  // Handle contenteditable elements
  const selection = window.getSelection();
  if (!selection.rangeCount) {
    // No cursor position — append text at the end
    const textNode = document.createTextNode(text);
    field.appendChild(textNode);
    const range = document.createRange();
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // Try execCommand first to preserve undo history
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const success = document.execCommand('insertText', false, text);

  if (!success) {
    // Fallback: manual range insertion
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Get the currently selected text on the page.
 * @returns {string}
 */
export function getSelectedText() {
  const selection = window.getSelection();
  return selection ? selection.toString().trim() : '';
}
```

## Task 5: core/promptBuilder.js — Prompt Construction Engine

Builds the system and user message arrays sent to LLM providers.

- [ ] Write `core/promptBuilder.js`

```javascript
// core/promptBuilder.js
// Constructs the system prompt and user message for LLM calls.

const TONE_GUIDES = {
  professional: 'Use a professional, polished tone. Be clear, concise, and authoritative.',
  casual: 'Use a relaxed, conversational tone. Be friendly and approachable.',
  witty: 'Use a witty, clever tone. Add humor and personality while staying on topic.',
  direct: 'Use a direct, no-nonsense tone. Be straightforward and to the point.'
};

const TASK_INSTRUCTIONS = {
  reply: 'Write a reply to the post or comment provided in the context below.',
  comment: 'Write a comment on the post provided in the context below.',
  post: 'Write a new original post based on the topic or draft provided in the context.',
  rewrite: 'Rewrite and improve the text provided in the context below.',
  expand: 'Expand on the ideas in the text provided in the context below. Add more detail and depth.',
  summarize: 'Summarize the post or text provided in the context below concisely.'
};

/**
 * Build the messages array for an LLM call.
 * @param {{ platform: string, task: string, tone: string, context: { postText?: string, author?: string, nearbyComments?: string[], selectedText?: string }, personality: string }} params
 * @returns {{ messages: Array<{role: string, content: string}>, maxTokens: number }}
 */
export function buildPrompt({ platform, task, tone, context, personality }) {
  const toneGuide = TONE_GUIDES[tone] || TONE_GUIDES.professional;
  const taskInstruction = TASK_INSTRUCTIONS[task] || TASK_INSTRUCTIONS.reply;

  const systemLines = [
    'You are Social AI Copilot, an intelligent writing assistant embedded in a social media platform.',
    '',
    'Platform: ' + platform,
    personality,
    '',
    'Task: ' + taskInstruction,
    '',
    'Tone: ' + toneGuide,
    '',
    'Rules:',
    '- Write ONLY the response text. Do not add prefixes like "Response:" or "Here is your reply:".',
    '- Do not include any meta-commentary about the task.',
    '- Match the language of the input context. If the context is in Spanish, reply in Spanish.',
    '- Keep the response appropriate for the platform and its typical content length.',
    '- If context includes a specific question, answer it directly.',
    '- Do not make up facts or quotes that are not in the provided context.'
  ];
  const systemMessage = systemLines.join('\n');

  const userParts = [];

  if (context.selectedText) {
    userParts.push('Selected/highlighted text:\n"""\n' + context.selectedText + '\n"""');
  }

  if (context.postText) {
    userParts.push('Original post content:\n"""\n' + context.postText + '\n"""');
  }

  if (context.author) {
    userParts.push('Author: ' + context.author);
  }

  if (context.nearbyComments && context.nearbyComments.length > 0) {
    const commentLines = context.nearbyComments.map(function(c, i) {
      return (i + 1) + '. ' + c;
    }).join('\n');
    userParts.push('Nearby comments for context:\n' + commentLines);
  }

  if (userParts.length === 0) {
    userParts.push('No specific context was detected. Write a helpful response based on the task and tone instructions.');
  }

  const userMessage = userParts.join('\n\n');

  // Set max tokens based on platform and task
  let maxTokens = 300;
  if (platform === 'x') maxTokens = 280;
  if (task === 'post' || task === 'expand') maxTokens = 500;
  if (task === 'summarize') maxTokens = 150;

  return {
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage }
    ],
    maxTokens: maxTokens
  };
}
```

## Task 6: core/providers/openai.js — OpenAI API Adapter

Implements the OpenAI Chat Completions provider.

- [ ] Write `core/providers/openai.js`

```javascript
// core/providers/openai.js
// OpenAI Chat Completions API adapter.

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Call the OpenAI Chat Completions API.
 * @param {Array<{role: string, content: string}>} messages
 * @param {{ apiKey: string, model?: string, maxTokens?: number }} options
 * @returns {Promise<string>} The generated text.
 */
export async function generate(messages, options) {
  const apiKey = options.apiKey;
  const model = options.model || 'gpt-4o-mini';
  const maxTokens = options.maxTokens || 300;

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      max_tokens: maxTokens,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error('OpenAI API error (' + response.status + '): ' + errorBody);
  }

  const data = await response.json();

  if (!data.choices || data.choices.length === 0) {
    throw new Error('OpenAI API returned no choices.');
  }

  return data.choices[0].message.content.trim();
}
```

## Task 7: core/providers/glm.js — GLM API Adapter

Implements the Zhipu AI GLM provider.

- [ ] Write `core/providers/glm.js`

```javascript
// core/providers/glm.js
// GLM (Zhipu AI) API adapter.

const GLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

/**
 * Call the GLM Chat Completions API.
 * @param {Array<{role: string, content: string}>} messages
 * @param {{ apiKey: string, model?: string, maxTokens?: number }} options
 * @returns {Promise<string>} The generated text.
 */
export async function generate(messages, options) {
  const apiKey = options.apiKey;
  const model = options.model || 'glm-4-flash';
  const maxTokens = options.maxTokens || 300;

  const response = await fetch(GLM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      max_tokens: maxTokens,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error('GLM API error (' + response.status + '): ' + errorBody);
  }

  const data = await response.json();

  if (!data.choices || data.choices.length === 0) {
    throw new Error('GLM API returned no choices.');
  }

  return data.choices[0].message.content.trim();
}
```

## Task 8: core/providers/backendProxy.js — Backend Proxy Adapter

Routes AI calls through the user's own backend server with token auth.

- [ ] Write `core/providers/backendProxy.js`

```javascript
// core/providers/backendProxy.js
// Backend proxy adapter — routes AI requests through the user's own backend server.

/**
 * Call the user's backend proxy endpoint for AI generation.
 * The backend is expected to accept a POST with { messages, options }
 * and return { text: string } on success.
 * @param {Array<{role: string, content: string}>} messages
 * @param {{ backendToken: string, backendUrl?: string, maxTokens?: number }} options
 * @returns {Promise<string>} The generated text.
 */
export async function generate(messages, options) {
  const backendToken = options.backendToken;
  const backendUrl = options.backendUrl || 'https://localhost:3000/api/generate';
  const maxTokens = options.maxTokens || 300;

  const response = await fetch(backendUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + backendToken
    },
    body: JSON.stringify({
      messages: messages,
      max_tokens: maxTokens,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error('Backend proxy error (' + response.status + '): ' + errorBody);
  }

  const data = await response.json();

  // Support both { text: "..." } and { choices: [{ message: { content: "..." } }] }
  if (data.text) {
    return data.text.trim();
  }

  if (data.choices && data.choices.length > 0 && data.choices[0].message) {
    return data.choices[0].message.content.trim();
  }

  if (data.content) {
    return data.content.trim();
  }

  throw new Error('Backend proxy returned unexpected response format: ' + JSON.stringify(data));
}
```

## Task 9: core/aiProvider.js — Provider Registry and Dispatcher

Central registry for AI providers with a unified call interface.

- [ ] Write `core/aiProvider.js`

```javascript
// core/aiProvider.js
// Provider registry and dispatcher.
// Providers are registered by ID and dispatched by the settings' provider field.

/** @type {Map<string, { generate: Function }>} */
const providers = new Map();

/**
 * Register a provider adapter.
 * @param {string} id - Unique provider identifier (e.g. 'openai', 'glm', 'backend').
 * @param {{ generate: (messages: Array, options: object) => Promise<string> }} adapter
 */
export function registerProvider(id, adapter) {
  if (typeof adapter.generate !== 'function') {
    throw new Error('Provider "' + id + '" must export a generate function.');
  }
  providers.set(id, adapter);
}

/**
 * Call a registered provider's generate function.
 * @param {string} providerId - The registered provider ID.
 * @param {Array<{role: string, content: string}>} messages - The message array.
 * @param {object} options - Provider-specific options (apiKey, model, maxTokens, etc.).
 * @returns {Promise<string>} The generated text.
 */
export async function callProvider(providerId, messages, options) {
  const provider = providers.get(providerId);
  if (!provider) {
    throw new Error('Unknown provider: "' + providerId + '". Registered: ' + Array.from(providers.keys()).join(', '));
  }
  return provider.generate(messages, options);
}

/**
 * List all registered provider IDs.
 * @returns {string[]}
 */
export function listProviders() {
  return Array.from(providers.keys());
}
```

## Task 10: core/contextExtractor.js — Context Extraction

Extracts surrounding post content, author, nearby comments, and user-selected text from the page.

- [ ] Write `core/contextExtractor.js`

```javascript
// core/contextExtractor.js
// Extracts context from the page: the nearest post, author, comments, and selected text.
// Uses the platform selector configuration from utils/platform.js.

/**
 * Walk up the DOM tree from the active element to find the nearest ancestor
 * matching one of the given selectors.
 * @param {HTMLElement} element
 * @param {string[]} selectors
 * @param {number} maxDepth
 * @returns {HTMLElement|null}
 */
function findNearestAncestor(element, selectors, maxDepth) {
  maxDepth = maxDepth || 15;
  var current = element;
  var depth = 0;
  while (current && current !== document.body && depth < maxDepth) {
    for (var i = 0; i < selectors.length; i++) {
      if (current.matches && current.matches(selectors[i])) {
        return current;
      }
    }
    current = current.parentElement;
    depth++;
  }
  return null;
}

/**
 * Safibly extract text content from an element, limiting to a max length.
 * @param {HTMLElement} el
 * @param {number} maxLength
 * @returns {string}
 */
function extractText(el, maxLength) {
  maxLength = maxLength || 2000;
  if (!el) return '';
  var text = (el.innerText || el.textContent || '').trim();
  if (text.length > maxLength) {
    text = text.substring(0, maxLength) + '...';
  }
  return text;
}

/**
 * Extract context around the currently focused editable field.
 * @param {HTMLElement} activeElement - The focused editable element.
 * @param {{ editableFields: string[], postContainers: string[], authorSelector: string }} platformConfig
 * @returns {{ postText: string, author: string, nearbyComments: string[], selectedText: string }}
 */
export function extractContext(activeElement, platformConfig) {
  var result = {
    postText: '',
    author: '',
    nearbyComments: [],
    selectedText: ''
  };

  if (!activeElement || !platformConfig) return result;

  // Get user-selected text
  var selection = window.getSelection();
  if (selection && selection.toString().trim()) {
    result.selectedText = selection.toString().trim();
  }

  // Find the nearest post container
  var postEl = findNearestAncestor(activeElement, platformConfig.postContainers, 20);

  if (postEl) {
    result.postText = extractText(postEl);

    // Try to find the author within the post container
    if (platformConfig.authorSelector) {
      var authorEls = postEl.querySelectorAll(platformConfig.authorSelector);
      if (authorEls.length > 0) {
        result.author = (authorEls[0].innerText || authorEls[0].textContent || '').trim();
      }
    }

    // Collect nearby comments (sibling post containers nearby)
    var siblingComments = postEl.parentElement ? postEl.parentElement.children : [];
    var comments = [];
    for (var i = 0; i < siblingComments.length && comments.length < 5; i++) {
      var sibling = siblingComments[i];
      if (sibling !== postEl) {
        // Check if this sibling matches any post container selector
        for (var j = 0; j < platformConfig.postContainers.length; j++) {
          if (sibling.matches && sibling.matches(platformConfig.postContainers[j])) {
            var commentText = extractText(sibling, 500);
            if (commentText) {
              comments.push(commentText);
            }
            break;
          }
        }
      }
    }
    result.nearbyComments = comments;
  } else {
    // No post container found — check if the active element itself has content
    var fieldText = extractText(activeElement, 1000);
    if (fieldText) {
      result.postText = fieldText;
    }
  }

  return result;
}

/**
 * Pick a specific post element by index from all matching post containers on the page.
 * Useful when the user wants to reply to a specific post.
 * @param {{ postContainers: string[] }} platformConfig
 * @param {number} index - 0-based index of the post to select.
 * @returns {{ postText: string, author: string }} The post content and author.
 */
export function pickPost(platformConfig, index) {
  var result = { postText: '', author: '' };
  if (!platformConfig || !platformConfig.postContainers) return result;

  var allPosts = [];
  for (var i = 0; i < platformConfig.postContainers.length; i++) {
    var found = document.querySelectorAll(platformConfig.postContainers[i]);
    for (var j = 0; j < found.length; j++) {
      allPosts.push(found[j]);
    }
  }

  if (index < 0 || index >= allPosts.length) return result;

  var postEl = allPosts[index];
  result.postText = extractText(postEl);

  if (platformConfig.authorSelector) {
    var authorEls = postEl.querySelectorAll(platformConfig.authorSelector);
    if (authorEls.length > 0) {
      result.author = (authorEls[0].innerText || authorEls[0].textContent || '').trim();
    }
  }

  return result;
}
```

## Task 11: core/uiManager.js + styles.css — UI Components

Creates the floating trigger button, popover panel with actions, tone selector, loading/result states, and all CSS.

- [ ] Write `core/uiManager.js`

```javascript
// core/uiManager.js
// Creates and manages the AI trigger button and floating popover.
// All DOM creation uses createElement — no innerHTML with user data.

var currentPopover = null;
var currentTrigger = null;

/**
 * Create the AI trigger button and anchor it next to the given editable field.
 * @param {HTMLElement} field - The editable field to anchor the trigger to.
 * @returns {{ trigger: HTMLElement, field: HTMLElement }}
 */
export function createTrigger(field) {
  // Remove any existing trigger
  removeExistingTrigger();

  var trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'saic-trigger';
  trigger.setAttribute('aria-label', 'Open AI Copilot');
  trigger.setAttribute('title', 'AI Copilot (Ctrl+Shift+A)');
  trigger.textContent = 'AI';

  // Create a wrapper to position the trigger relative to the field
  var wrapper = document.createElement('div');
  wrapper.className = 'saic-trigger-wrapper';
  wrapper.appendChild(trigger);

  // Insert the wrapper right after the field in the DOM
  field.parentNode.insertBefore(wrapper, field.nextSibling);
  positionTrigger(wrapper, field);

  currentTrigger = { trigger: trigger, wrapper: wrapper, field: field };

  return currentTrigger;
}

/**
 * Position the trigger wrapper at the bottom-right of the field.
 * @param {HTMLElement} wrapper
 * @param {HTMLElement} field
 */
function positionTrigger(wrapper, field) {
  var rect = field.getBoundingClientRect();
  wrapper.style.position = 'fixed';
  wrapper.style.left = (rect.right - 44) + 'px';
  wrapper.style.top = (rect.bottom + 4) + 'px';
  wrapper.style.zIndex = '999998';
}

/**
 * Remove the existing trigger if present.
 */
function removeExistingTrigger() {
  if (currentTrigger && currentTrigger.wrapper && currentTrigger.wrapper.parentNode) {
    currentTrigger.wrapper.parentNode.removeChild(currentTrigger.wrapper);
  }
  currentTrigger = null;
}

/**
 * Show the popover panel anchored to the trigger button.
 * @param {HTMLElement} triggerEl - The trigger button element.
 * @param {{ onAction: Function, onClose: Function }} options
 * @returns {{ el: HTMLElement, setContent: Function, setLoading: Function, setError: Function, hide: Function }}
 */
export function showPopover(triggerEl, options) {
  hidePopover();

  var popover = document.createElement('div');
  popover.className = 'saic-popover';

  // Header
  var header = document.createElement('div');
  header.className = 'saic-popover-header';

  var title = document.createElement('span');
  title.className = 'saic-popover-title';
  title.textContent = 'AI Copilot';
  header.appendChild(title);

  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'saic-popover-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', function() {
    hidePopover();
    if (options.onClose) options.onClose();
  });
  header.appendChild(closeBtn);

  popover.appendChild(header);

  // Action buttons
  var actions = document.createElement('div');
  actions.className = 'saic-popover-actions';

  var actionTypes = [
    { id: 'reply', label: 'Reply' },
    { id: 'comment', label: 'Comment' },
    { id: 'post', label: 'New Post' },
    { id: 'rewrite', label: 'Rewrite' },
    { id: 'expand', label: 'Expand' },
    { id: 'summarize', label: 'Summarize' }
  ];

  actionTypes.forEach(function(action) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'saic-action-btn';
    btn.textContent = action.label;
    btn.setAttribute('data-action', action.id);
    btn.addEventListener('click', function() {
      if (options.onAction) options.onAction(action.id);
    });
    actions.appendChild(btn);
  });

  popover.appendChild(actions);

  // Tone selector
  var toneRow = document.createElement('div');
  toneRow.className = 'saic-tone-row';

  var toneLabel = document.createElement('span');
  toneLabel.className = 'saic-tone-label';
  toneLabel.textContent = 'Tone:';
  toneRow.appendChild(toneLabel);

  var toneSelect = document.createElement('select');
  toneSelect.className = 'saic-tone-select';
  var tones = ['professional', 'casual', 'witty', 'direct'];
  tones.forEach(function(t) {
    var opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
    toneSelect.appendChild(opt);
  });
  toneRow.appendChild(toneSelect);
  popover.appendChild(toneRow);

  // Result area
  var resultArea = document.createElement('div');
  resultArea.className = 'saic-result-area';
  resultArea.style.display = 'none';
  popover.appendChild(resultArea);

  // Insert button (shown after generation)
  var insertBtn = document.createElement('button');
  insertBtn.type = 'button';
  insertBtn.className = 'saic-insert-btn';
  insertBtn.textContent = 'Insert';
  insertBtn.style.display = 'none';
  popover.appendChild(insertBtn);

  // Position the popover below the trigger
  var triggerRect = triggerEl.getBoundingClientRect();
  popover.style.position = 'fixed';
  popover.style.left = Math.max(8, triggerRect.left - 180) + 'px';
  popover.style.top = (triggerRect.bottom + 8) + 'px';
  popover.style.zIndex = '999999';

  document.body.appendChild(popover);
  currentPopover = popover;

  // Return a controller object for external manipulation
  var controller = {
    el: popover,
    toneSelect: toneSelect,

    setContent: function(text) {
      resultArea.style.display = 'block';
      resultArea.textContent = text; // Safe: textContent, not innerHTML
      insertBtn.style.display = 'block';
    },

    setLoading: function(isLoading) {
      if (isLoading) {
        resultArea.style.display = 'block';
        resultArea.textContent = 'Generating...';
        resultArea.className = 'saic-result-area saic-loading';
        insertBtn.style.display = 'none';
      } else {
        resultArea.className = 'saic-result-area';
      }
    },

    setError: function(message) {
      resultArea.style.display = 'block';
      resultArea.textContent = 'Error: ' + message;
      resultArea.className = 'saic-result-area saic-error';
      insertBtn.style.display = 'none';
    },

    getTone: function() {
      return toneSelect.value;
    },

    onInsert: function(callback) {
      insertBtn.addEventListener('click', function() {
        if (callback) callback(resultArea.textContent);
      });
    },

    hide: function() {
      hidePopover();
    }
  };

  return controller;
}

/**
 * Hide and remove the current popover.
 */
export function hidePopover() {
  if (currentPopover && currentPopover.parentNode) {
    currentPopover.parentNode.removeChild(currentPopover);
  }
  currentPopover = null;
}

/**
 * Insert generated text into the target editable field using the DOM utility.
 * @param {HTMLElement} field
 * @param {string} text
 */
export function insertText(field, text) {
  // Import dynamically to avoid circular deps — the import will be resolved at runtime
  // Since this runs as a content script, we use the global inserted by content.js
  if (window.__saic_insertTextAtCursor) {
    window.__saic_insertTextAtCursor(field, text);
  } else {
    // Direct fallback
    field.focus();
    document.execCommand('insertText', false, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
```

- [ ] Write `extension/styles.css`

```css
/* styles.css — Social AI Copilot injected styles */

/* ===== Trigger Button ===== */
.saic-trigger-wrapper {
  pointer-events: auto;
}

.saic-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  padding: 0;
  line-height: 1;
}

.saic-trigger:hover {
  transform: scale(1.1);
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.55);
}

.saic-trigger:active {
  transform: scale(0.95);
}

/* ===== Popover Panel ===== */
.saic-popover {
  width: 380px;
  max-height: 520px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.06);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #1a1a2e;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: saic-fade-in 0.2s ease-out;
}

@keyframes saic-fade-in {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ===== Header ===== */
.saic-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: #fff;
}

.saic-popover-title {
  font-weight: 600;
  font-size: 14px;
}

.saic-popover-close {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.8);
  font-size: 20px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  transition: color 0.15s;
}

.saic-popover-close:hover {
  color: #fff;
}

/* ===== Action Buttons ===== */
.saic-popover-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 12px 16px;
}

.saic-action-btn {
  padding: 6px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  color: #475569;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}

.saic-action-btn:hover {
  background: #6366f1;
  color: #fff;
  border-color: #6366f1;
}

/* ===== Tone Row ===== */
.saic-tone-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px 12px 16px;
}

.saic-tone-label {
  font-size: 13px;
  color: #64748b;
  font-weight: 500;
}

.saic-tone-select {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 13px;
  color: #475569;
  background: #fff;
  font-family: inherit;
  cursor: pointer;
}

/* ===== Result Area ===== */
.saic-result-area {
  padding: 12px 16px;
  font-size: 14px;
  line-height: 1.6;
  color: #1e293b;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
  border-top: 1px solid #f1f5f9;
}

.saic-result-area.saic-loading {
  color: #94a3b8;
  font-style: italic;
}

@keyframes saic-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.saic-result-area.saic-loading {
  animation: saic-pulse 1.5s ease-in-out infinite;
}

.saic-result-area.saic-error {
  color: #ef4444;
  background: #fef2f2;
}

/* ===== Insert Button ===== */
.saic-insert-btn {
  margin: 12px 16px;
  padding: 8px 20px;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  font-family: inherit;
}

.saic-insert-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
}

.saic-insert-btn:active {
  transform: translateY(0);
}
```

## Task 12: content.js — Main Orchestrator

The content script entry point. Detects platform, watches for editable fields via MutationObserver, creates triggers,
manages popover lifecycle, and sends AI generation requests to background.js via chrome.runtime.sendMessage.

Note: Content scripts in MV3 cannot use ES module imports with `type: module` in manifest content_scripts.
All needed logic is inlined. The standalone modules (utils/dom.js, core/uiManager.js, etc.) serve as the
authoritative source and are used by tests and the popup. content.js duplicates the runtime logic.

- [ ] Write `extension/content.js`

```javascript
// content.js
// Main content script entry point.
// Detects platform, watches for editable fields, manages triggers and popovers,
// and communicates with background.js for AI generation.

(function() {
  'use strict';

  // ── State ──
  var platformConfig = null;
  var platformName = null;
  var activeField = null;
  var popoverController = null;
  var observer = null;

  // ── Expose insertTextAtCursor for uiManager to use ──
  // (uiManager.js cannot import ES modules in content script context;
  //  content.js provides the bridge.)

  function insertTextAtCursor(field, text) {
    field.focus();

    if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
      var start = field.selectionStart;
      var end = field.selectionEnd;
      var value = field.value;
      field.value = value.substring(0, start) + text + value.substring(end);
      field.selectionStart = field.selectionEnd = start + text.length;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // contenteditable
    var selection = window.getSelection();
    if (!selection.rangeCount) {
      var tn = document.createTextNode(text);
      field.appendChild(tn);
      var r = document.createRange();
      r.setStartAfter(tn);
      r.collapse(true);
      selection.removeAllRanges();
      selection.addRange(r);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    var range = selection.getRangeAt(0);
    range.deleteContents();
    var ok = document.execCommand('insertText', false, text);
    if (!ok) {
      var tn2 = document.createTextNode(text);
      range.insertNode(tn2);
      range.setStartAfter(tn2);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  window.__saic_insertTextAtCursor = insertTextAtCursor;

  // ── Platform detection ──
  function detectPlatform(url) {
    if (!url) return null;
    var hostname = '';
    try { hostname = new URL(url).hostname; } catch(e) { return null; }
    if (hostname.indexOf('linkedin.com') !== -1) return 'linkedin';
    if (hostname.indexOf('facebook.com') !== -1) return 'facebook';
    if (hostname.indexOf('x.com') !== -1 || hostname.indexOf('twitter.com') !== -1) return 'x';
    if (hostname.indexOf('reddit.com') !== -1) return 'reddit';
    return null;
  }

  // ── Platform configs (inline to avoid import issues in content scripts) ──
  var PLATFORMS = {
    linkedin: {
      editableFields: [
        '.ql-editor[contenteditable="true"]',
        '.msg-form__contenteditable[contenteditable="true"]',
        '.comments-comment-texteditor[contenteditable="true"]',
        '[data-placeholder*="post"]',
        '[aria-label*="Post"]',
        '[aria-label*="comment"]',
        '[aria-label*="message"]'
      ],
      postContainers: [
        '.feed-shared-update-v2',
        '.comments-comments-list__comment-item',
        '.msg-s-message-listevent'
      ],
      authorSelector: '.update-components-actor__title span[dir="ltr"], .comments-post-meta__actor span[dir="ltr"]',
      personality: 'You are writing for LinkedIn. The tone should be professional and thought-leadership oriented. Use industry-relevant language. Keep content polished and suitable for a business network.'
    },
    facebook: {
      editableFields: [
        '[aria-label*="Post"][role="textbox"]',
        '[aria-label*="comment"][role="textbox"]',
        '[data-text="true"]',
        '[contenteditable="true"][aria-label*="Write"]'
      ],
      postContainers: [
        '[data-pagelet*="feed"] [role="article"]',
        '[aria-label*="Comment"]'
      ],
      authorSelector: 'a[role="link"] span a span, h4 a span',
      personality: 'You are writing for Facebook. The tone should be friendly, conversational, and engaging. Content should feel natural and encourage interaction.'
    },
    x: {
      editableFields: [
        '[data-testid="tweetTextarea_0"]',
        '[data-testid="tweetTextarea_1"]',
        '.public-DraftEditor-content[contenteditable="true"]',
        '[placeholder*="Tweet"]',
        '[aria-label*="Tweet text"]'
      ],
      postContainers: [
        '[data-testid="tweet"]',
        'article[data-testid="tweet"]'
      ],
      authorSelector: '[data-testid="User-Name"] a span',
      personality: 'You are writing for X (Twitter). Be concise, punchy, and impactful. Use hashtags strategically. Respect the character-limited culture even when writing longer posts.'
    },
    reddit: {
      editableFields: [
        '.public-DraftEditor-content[contenteditable="true"]',
        'textarea[name="text"]',
        'textarea#comment-textarea',
        '[contenteditable="true"]',
        '.md textarea'
      ],
      postContainers: [
        '.thing.link',
        '.thing.comment',
        '[data-testid="post-container"]',
        '.Comment'
      ],
      authorSelector: '.author, a[data-testid="post_author_link"], [data-testid="comment_author_link"]',
      personality: 'You are writing for Reddit. Be authentic, knowledgeable, and community-aware. Match the subreddit culture. Avoid overly marketing language. Use proper formatting with Markdown.'
    }
  };

  // ── Context extraction ──
  function getSelectedText() {
    var sel = window.getSelection();
    return sel ? sel.toString().trim() : '';
  }

  function findNearestAncestor(element, selectors, maxDepth) {
    maxDepth = maxDepth || 15;
    var current = element;
    var depth = 0;
    while (current && current !== document.body && depth < maxDepth) {
      for (var i = 0; i < selectors.length; i++) {
        if (current.matches && current.matches(selectors[i])) {
          return current;
        }
      }
      current = current.parentElement;
      depth++;
    }
    return null;
  }

  function extractText(el, maxLength) {
    maxLength = maxLength || 2000;
    if (!el) return '';
    var text = (el.innerText || el.textContent || '').trim();
    if (text.length > maxLength) text = text.substring(0, maxLength) + '...';
    return text;
  }

  function extractContext(activeEl) {
    var result = { postText: '', author: '', nearbyComments: [], selectedText: '' };
    if (!activeEl || !platformConfig) return result;

    result.selectedText = getSelectedText();

    var postEl = findNearestAncestor(activeEl, platformConfig.postContainers, 20);
    if (postEl) {
      result.postText = extractText(postEl);
      if (platformConfig.authorSelector) {
        var authorEls = postEl.querySelectorAll(platformConfig.authorSelector);
        if (authorEls.length > 0) {
          result.author = (authorEls[0].innerText || authorEls[0].textContent || '').trim();
        }
      }
      var siblings = postEl.parentElement ? postEl.parentElement.children : [];
      var comments = [];
      for (var i = 0; i < siblings.length && comments.length < 5; i++) {
        if (siblings[i] !== postEl) {
          for (var j = 0; j < platformConfig.postContainers.length; j++) {
            if (siblings[i].matches && siblings[i].matches(platformConfig.postContainers[j])) {
              var ct = extractText(siblings[i], 500);
              if (ct) comments.push(ct);
              break;
            }
          }
        }
      }
      result.nearbyComments = comments;
    } else {
      var ft = extractText(activeEl, 1000);
      if (ft) result.postText = ft;
    }
    return result;
  }

  // ── UI creation (inline since content scripts can't use ES module imports) ──
  var currentPopoverEl = null;
  var currentTriggerWrapper = null;

  function removeExistingTrigger() {
    if (currentTriggerWrapper && currentTriggerWrapper.parentNode) {
      currentTriggerWrapper.parentNode.removeChild(currentTriggerWrapper);
    }
    currentTriggerWrapper = null;
  }

  function hidePopover() {
    if (currentPopoverEl && currentPopoverEl.parentNode) {
      currentPopoverEl.parentNode.removeChild(currentPopoverEl);
    }
    currentPopoverEl = null;
    popoverController = null;
  }

  function createTriggerForField(field) {
    removeExistingTrigger();
    hidePopover();

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'saic-trigger';
    trigger.setAttribute('aria-label', 'Open AI Copilot');
    trigger.setAttribute('title', 'AI Copilot (Ctrl+Shift+A)');
    trigger.textContent = 'AI';

    var wrapper = document.createElement('div');
    wrapper.className = 'saic-trigger-wrapper';
    wrapper.appendChild(trigger);

    field.parentNode.insertBefore(wrapper, field.nextSibling);

    var rect = field.getBoundingClientRect();
    wrapper.style.position = 'fixed';
    wrapper.style.left = (rect.right - 44) + 'px';
    wrapper.style.top = (rect.bottom + 4) + 'px';
    wrapper.style.zIndex = '999998';

    currentTriggerWrapper = wrapper;
    activeField = field;

    trigger.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      openPopover(trigger, field);
    });

    return { trigger: trigger, wrapper: wrapper, field: field };
  }

  function openPopover(triggerEl, field) {
    hidePopover();

    var popover = document.createElement('div');
    popover.className = 'saic-popover';

    // Header
    var header = document.createElement('div');
    header.className = 'saic-popover-header';
    var title = document.createElement('span');
    title.className = 'saic-popover-title';
    title.textContent = 'AI Copilot';
    header.appendChild(title);
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'saic-popover-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', function() { hidePopover(); });
    header.appendChild(closeBtn);
    popover.appendChild(header);

    // Actions
    var actions = document.createElement('div');
    actions.className = 'saic-popover-actions';
    var actionTypes = [
      { id: 'reply', label: 'Reply' },
      { id: 'comment', label: 'Comment' },
      { id: 'post', label: 'New Post' },
      { id: 'rewrite', label: 'Rewrite' },
      { id: 'expand', label: 'Expand' },
      { id: 'summarize', label: 'Summarize' }
    ];
    actionTypes.forEach(function(action) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'saic-action-btn';
      btn.textContent = action.label;
      btn.setAttribute('data-action', action.id);
      btn.addEventListener('click', function() {
        handleAction(action.id, toneSelect.value, field, resultArea, insertBtn);
      });
      actions.appendChild(btn);
    });
    popover.appendChild(actions);

    // Tone
    var toneRow = document.createElement('div');
    toneRow.className = 'saic-tone-row';
    var toneLabel = document.createElement('span');
    toneLabel.className = 'saic-tone-label';
    toneLabel.textContent = 'Tone:';
    toneRow.appendChild(toneLabel);
    var toneSelect = document.createElement('select');
    toneSelect.className = 'saic-tone-select';
    ['professional', 'casual', 'witty', 'direct'].forEach(function(t) {
      var opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      toneSelect.appendChild(opt);
    });
    toneRow.appendChild(toneSelect);
    popover.appendChild(toneRow);

    // Result
    var resultArea = document.createElement('div');
    resultArea.className = 'saic-result-area';
    resultArea.style.display = 'none';
    popover.appendChild(resultArea);

    // Insert button
    var insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.className = 'saic-insert-btn';
    insertBtn.textContent = 'Insert';
    insertBtn.style.display = 'none';
    popover.appendChild(insertBtn);

    // Position
    var triggerRect = triggerEl.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.left = Math.max(8, triggerRect.left - 180) + 'px';
    popover.style.top = (triggerRect.bottom + 8) + 'px';
    popover.style.zIndex = '999999';

    document.body.appendChild(popover);
    currentPopoverEl = popover;
  }

  // ── Action handler ──
  function handleAction(task, tone, field, resultArea, insertBtn) {
    var context = extractContext(field);

    resultArea.style.display = 'block';
    resultArea.textContent = 'Generating...';
    resultArea.className = 'saic-result-area saic-loading';
    insertBtn.style.display = 'none';

    // Send message to background.js
    chrome.runtime.sendMessage({
      type: 'generate',
      data: {
        platform: platformName,
        task: task,
        tone: tone,
        context: context,
        personality: platformConfig.personality
      }
    }, function(response) {
      if (chrome.runtime.lastError) {
        resultArea.textContent = 'Error: ' + chrome.runtime.lastError.message;
        resultArea.className = 'saic-result-area saic-error';
        return;
      }
      if (response && response.error) {
        resultArea.textContent = 'Error: ' + response.error;
        resultArea.className = 'saic-result-area saic-error';
        return;
      }
      if (response && response.text) {
        resultArea.textContent = response.text;
        resultArea.className = 'saic-result-area';
        insertBtn.style.display = 'block';

        // Remove previous insert listeners by cloning
        var newInsertBtn = insertBtn.cloneNode(true);
        insertBtn.parentNode.replaceChild(newInsertBtn, insertBtn);
        newInsertBtn.addEventListener('click', function() {
          insertTextAtCursor(field, response.text);
          hidePopover();
        });
      }
    });
  }

  // ── MutationObserver — watch for editable fields ──
  function isEditableField(el) {
    if (!el || !el.matches) return false;
    if (!platformConfig) return false;
    for (var i = 0; i < platformConfig.editableFields.length; i++) {
      if (el.matches(platformConfig.editableFields[i])) return true;
    }
    return false;
  }

  function setupObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        if (!added) continue;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          // Check if the added node itself is an editable field
          if (isEditableField(node)) {
            createTriggerForField(node);
          }
          // Check descendants
          if (node.querySelectorAll) {
            var fields = node.querySelectorAll(platformConfig.editableFields.join(', '));
            for (var k = 0; k < fields.length; k++) {
              createTriggerForField(fields[k]);
            }
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Focus listener — create trigger when user focuses an editable field ──
  function setupFocusListener() {
    document.addEventListener('focusin', function(e) {
      var target = e.target;
      if (isEditableField(target)) {
        activeField = target;
        // Only create trigger if one doesn't exist for this field
        if (!currentTriggerWrapper || currentTriggerWrapper.__saic_field !== target) {
          var trig = createTriggerForField(target);
          if (trig) trig.wrapper.__saic_field = target;
        }
      }
    });
  }

  // ── Keyboard shortcut handler (from background.js command) ──
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.type === 'triggerShortcut') {
      if (activeField) {
        // Find or create trigger
        var existingTrigger = currentTriggerWrapper ? currentTriggerWrapper.querySelector('.saic-trigger') : null;
        if (existingTrigger) {
          openPopover(existingTrigger, activeField);
        } else {
          var trig = createTriggerForField(activeField);
          if (trig && trig.trigger) {
            openPopover(trig.trigger, activeField);
          }
        }
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'No active editable field found.' });
      }
    }
  });

  // ── Click outside to close ──
  document.addEventListener('click', function(e) {
    if (currentPopoverEl && !currentPopoverEl.contains(e.target)) {
      var isTrigger = e.target.classList && e.target.classList.contains('saic-trigger');
      if (!isTrigger) {
        hidePopover();
      }
    }
  });

  // ── Initialization ──
  function init() {
    platformName = detectPlatform(window.location.href);
    if (!platformName) return;

    platformConfig = PLATFORMS[platformName];
    if (!platformConfig) return;

    // Check if platform is enabled
    chrome.storage.local.get('socialAiCopilot_settings', function(result) {
      var settings = result.socialAiCopilot_settings || {};
      var platforms = settings.platforms || {};
      if (platforms[platformName] === false) return; // Disabled for this platform

      // Set up default tone in tone selector (if saved)
      setupFocusListener();
      setupObserver();

      // Initial scan for existing fields
      var selector = platformConfig.editableFields.join(', ');
      var existingFields = document.querySelectorAll(selector);
      for (var i = 0; i < existingFields.length; i++) {
        createTriggerForField(existingFields[i]);
      }
    });
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

## Task 13: background.js — Service Worker

Handles AI generation requests from content scripts, dispatches to the correct provider (OpenAI, GLM, or backend proxy),
saves generation history, and processes the Ctrl+Shift+A keyboard shortcut command.

Note: Service workers in MV3 cannot use dynamic imports from content scripts. All provider logic and prompt building
is inlined. The standalone module files serve as the testable source of truth.

- [ ] Write `extension/background.js`

```javascript
// background.js
// Service worker for the Social AI Copilot extension.
// Handles AI generation requests from content scripts, manages provider registration,
// and processes keyboard shortcut commands.

// ── Provider implementations (inlined for service worker) ──

/**
 * Call the OpenAI Chat Completions API.
 */
async function callOpenAI(messages, options) {
  var apiKey = options.apiKey;
  var model = options.model || 'gpt-4o-mini';
  var maxTokens = options.maxTokens || 300;

  var response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      max_tokens: maxTokens,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    var errorBody = await response.text();
    throw new Error('OpenAI API error (' + response.status + '): ' + errorBody);
  }

  var data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error('OpenAI API returned no choices.');
  }
  return data.choices[0].message.content.trim();
}

/**
 * Call the GLM (Zhipu AI) Chat Completions API.
 */
async function callGLM(messages, options) {
  var apiKey = options.apiKey;
  var model = options.model || 'glm-4-flash';
  var maxTokens = options.maxTokens || 300;

  var response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      max_tokens: maxTokens,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    var errorBody = await response.text();
    throw new Error('GLM API error (' + response.status + '): ' + errorBody);
  }

  var data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error('GLM API returned no choices.');
  }
  return data.choices[0].message.content.trim();
}

/**
 * Call the user's backend proxy.
 */
async function callBackendProxy(messages, options) {
  var backendToken = options.backendToken;
  var backendUrl = options.backendUrl || 'https://localhost:3000/api/generate';
  var maxTokens = options.maxTokens || 300;

  var response = await fetch(backendUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + backendToken
    },
    body: JSON.stringify({
      messages: messages,
      max_tokens: maxTokens,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    var errorBody = await response.text();
    throw new Error('Backend proxy error (' + response.status + '): ' + errorBody);
  }

  var data = await response.json();
  if (data.text) return data.text.trim();
  if (data.choices && data.choices.length > 0 && data.choices[0].message) {
    return data.choices[0].message.content.trim();
  }
  if (data.content) return data.content.trim();
  throw new Error('Backend proxy returned unexpected response format.');
}

// ── Prompt building (inlined for service worker) ──

var TONE_GUIDES = {
  professional: 'Use a professional, polished tone. Be clear, concise, and authoritative.',
  casual: 'Use a relaxed, conversational tone. Be friendly and approachable.',
  witty: 'Use a witty, clever tone. Add humor and personality while staying on topic.',
  direct: 'Use a direct, no-nonsense tone. Be straightforward and to the point.'
};

var TASK_INSTRUCTIONS = {
  reply: 'Write a reply to the post or comment provided in the context below.',
  comment: 'Write a comment on the post provided in the context below.',
  post: 'Write a new original post based on the topic or draft provided in the context.',
  rewrite: 'Rewrite and improve the text provided in the context below.',
  expand: 'Expand on the ideas in the text provided in the context below. Add more detail and depth.',
  summarize: 'Summarize the post or text provided in the context below concisely.'
};

function buildPrompt(platform, task, tone, context, personality) {
  var toneGuide = TONE_GUIDES[tone] || TONE_GUIDES.professional;
  var taskInstruction = TASK_INSTRUCTIONS[task] || TASK_INSTRUCTIONS.reply;

  var systemLines = [
    'You are Social AI Copilot, an intelligent writing assistant embedded in a social media platform.',
    '',
    'Platform: ' + platform,
    personality,
    '',
    'Task: ' + taskInstruction,
    '',
    'Tone: ' + toneGuide,
    '',
    'Rules:',
    '- Write ONLY the response text. Do not add prefixes like "Response:" or "Here is your reply:".',
    '- Do not include any meta-commentary about the task.',
    '- Match the language of the input context. If the context is in Spanish, reply in Spanish.',
    '- Keep the response appropriate for the platform and its typical content length.',
    '- If context includes a specific question, answer it directly.',
    '- Do not make up facts or quotes that are not in the provided context.'
  ];
  var systemMessage = systemLines.join('\n');

  var userParts = [];
  if (context.selectedText) {
    userParts.push('Selected/highlighted text:\n"""\n' + context.selectedText + '\n"""');
  }
  if (context.postText) {
    userParts.push('Original post content:\n"""\n' + context.postText + '\n"""');
  }
  if (context.author) {
    userParts.push('Author: ' + context.author);
  }
  if (context.nearbyComments && context.nearbyComments.length > 0) {
    var commentLines = context.nearbyComments.map(function(c, i) {
      return (i + 1) + '. ' + c;
    }).join('\n');
    userParts.push('Nearby comments for context:\n' + commentLines);
  }
  if (userParts.length === 0) {
    userParts.push('No specific context was detected. Write a helpful response based on the task and tone instructions.');
  }

  var userMessage = userParts.join('\n\n');

  var maxTokens = 300;
  if (platform === 'x') maxTokens = 280;
  if (task === 'post' || task === 'expand') maxTokens = 500;
  if (task === 'summarize') maxTokens = 150;

  return {
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage }
    ],
    maxTokens: maxTokens
  };
}

// ── Settings helper ──

var DEFAULT_SETTINGS = {
  provider: 'openai',
  authMode: 'user_key',
  apiKey: '',
  backendToken: '',
  defaultTone: 'professional',
  platforms: { linkedin: true, facebook: true, x: true, reddit: true }
};

async function getSettings() {
  return new Promise(function(resolve) {
    chrome.storage.local.get('socialAiCopilot_settings', function(result) {
      var stored = result.socialAiCopilot_settings || {};
      resolve({
        ...DEFAULT_SETTINGS,
        ...stored,
        platforms: { ...DEFAULT_SETTINGS.platforms, ...(stored.platforms || {}) }
      });
    });
  });
}

// ── History helper ──

async function saveHistory(entry) {
  return new Promise(function(resolve) {
    chrome.storage.local.get('socialAiCopilot_history', function(result) {
      var history = result.socialAiCopilot_history || [];
      history.unshift({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        ...entry
      });
      if (history.length > 100) history.length = 100;
      chrome.storage.local.set({ socialAiCopilot_history: history }, resolve);
    });
  });
}

// ── Message handler ──

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.type !== 'generate') return false;

  (async function() {
    try {
      var data = message.data;
      var settings = await getSettings();

      // Build the prompt
      var promptResult = buildPrompt(
        data.platform,
        data.task,
        data.tone,
        data.context,
        data.personality
      );

      // Determine provider and call
      var provider = settings.provider;
      var providerOptions = {
        apiKey: settings.apiKey,
        backendToken: settings.backendToken,
        maxTokens: promptResult.maxTokens
      };

      var text = '';

      if (provider === 'openai') {
        if (!settings.apiKey) throw new Error('OpenAI API key not configured. Open the extension settings to add it.');
        text = await callOpenAI(promptResult.messages, providerOptions);
      } else if (provider === 'glm') {
        if (!settings.apiKey) throw new Error('GLM API key not configured. Open the extension settings to add it.');
        text = await callGLM(promptResult.messages, providerOptions);
      } else if (provider === 'backend') {
        if (!settings.backendToken) throw new Error('Backend token not configured. Open the extension settings to add it.');
        text = await callBackendProxy(promptResult.messages, providerOptions);
      } else {
        throw new Error('Unknown provider: ' + provider);
      }

      // Save to history
      await saveHistory({
        platform: data.platform,
        task: data.task,
        tone: data.tone,
        input: data.context.postText || data.context.selectedText || '',
        output: text
      });

      sendResponse({ text: text });
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();

  return true; // Keep the message channel open for async sendResponse
});

// ── Keyboard shortcut handler ──

chrome.commands.onCommand.addListener(function(command) {
  if (command === 'trigger-ai') {
    // Send a message to the active tab's content script
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'triggerShortcut' }, function(response) {
          if (chrome.runtime.lastError) {
            // Content script may not be loaded on this page
            console.log('Social AI Copilot: Could not reach content script:', chrome.runtime.lastError.message);
          }
        });
      }
    });
  }
});

// ── Popup message handlers ──

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.type === 'getSettings') {
    getSettings().then(function(settings) {
      sendResponse(settings);
    });
    return true;
  }

  if (message.type === 'saveSettings') {
    (async function() {
      var current = await getSettings();
      var merged = { ...current, ...message.data, platforms: { ...current.platforms, ...(message.data.platforms || {}) } };
      chrome.storage.local.set({ socialAiCopilot_settings: merged }, function() {
        sendResponse({ ok: true });
      });
    })();
    return true;
  }

  if (message.type === 'getHistory') {
    chrome.storage.local.get('socialAiCopilot_history', function(result) {
      sendResponse(result.socialAiCopilot_history || []);
    });
    return true;
  }

  if (message.type === 'clearHistory') {
    chrome.storage.local.set({ socialAiCopilot_history: [] }, function() {
      sendResponse({ ok: true });
    });
    return true;
  }
});
```

## Task 14: popup.html + popup.js — Settings Panel

The extension popup for configuring provider, API keys, default tone, platform toggles, and viewing generation history.

- [ ] Write `extension/popup.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=400, initial-scale=1.0">
  <title>Social AI Copilot Settings</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      color: #1e293b;
      background: #f8fafc;
      width: 380px;
      min-height: 500px;
      max-height: 600px;
      overflow-y: auto;
    }
    .header {
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: #fff;
      padding: 16px;
    }
    .header h1 {
      font-size: 16px;
      font-weight: 700;
    }
    .header p {
      font-size: 11px;
      opacity: 0.8;
      margin-top: 4px;
    }
    .section {
      padding: 12px 16px;
      border-bottom: 1px solid #e2e8f0;
    }
    .section-title {
      font-size: 12px;
      font-weight: 600;
      color: #6366f1;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
    }
    label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: #475569;
      margin-bottom: 4px;
    }
    select, input[type="password"], input[type="text"] {
      width: 100%;
      padding: 7px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 13px;
      color: #1e293b;
      background: #fff;
      margin-bottom: 10px;
      font-family: inherit;
    }
    select:focus, input:focus {
      outline: none;
      border-color: #6366f1;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
    }
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 0;
    }
    .toggle-row span {
      font-size: 13px;
    }
    .toggle {
      position: relative;
      width: 36px;
      height: 20px;
    }
    .toggle input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .toggle-slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background: #cbd5e1;
      border-radius: 20px;
      transition: 0.2s;
    }
    .toggle-slider:before {
      content: "";
      position: absolute;
      height: 14px;
      width: 14px;
      left: 3px;
      bottom: 3px;
      background: #fff;
      border-radius: 50%;
      transition: 0.2s;
    }
    .toggle input:checked + .toggle-slider {
      background: #6366f1;
    }
    .toggle input:checked + .toggle-slider:before {
      transform: translateX(16px);
    }
    .save-btn {
      display: block;
      width: calc(100% - 32px);
      margin: 12px 16px;
      padding: 10px;
      border: none;
      border-radius: 8px;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .save-btn:hover { opacity: 0.9; }
    .status {
      text-align: center;
      padding: 0 16px;
      font-size: 12px;
      color: #22c55e;
      opacity: 0;
      transition: opacity 0.3s;
    }
    .status.show { opacity: 1; }
    .history-list {
      max-height: 150px;
      overflow-y: auto;
      margin-top: 8px;
    }
    .history-item {
      padding: 6px 0;
      border-bottom: 1px solid #f1f5f9;
      font-size: 12px;
    }
    .history-item .meta {
      color: #94a3b8;
      font-size: 11px;
    }
    .clear-btn {
      margin-top: 8px;
      padding: 4px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      background: #fff;
      color: #64748b;
      font-size: 11px;
      cursor: pointer;
    }
    .clear-btn:hover { background: #f1f5f9; }
    .key-hint {
      padding: 12px 16px;
      font-size: 11px;
      color: #94a3b8;
      text-align: center;
    }
    .key-hint kbd {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 3px;
      padding: 1px 5px;
      font-family: inherit;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Social AI Copilot</h1>
    <p>AI-powered writing assistant for social media</p>
  </div>

  <div class="section">
    <div class="section-title">Provider</div>
    <label for="provider">AI Provider</label>
    <select id="provider">
      <option value="openai">OpenAI (GPT)</option>
      <option value="glm">GLM (Zhipu AI)</option>
      <option value="backend">Backend Proxy</option>
    </select>

    <label for="apiKey">API Key</label>
    <input type="password" id="apiKey" placeholder="sk-..." autocomplete="off">

    <label for="backendToken" id="backendTokenLabel">Backend Token</label>
    <input type="password" id="backendToken" placeholder="your-backend-token" autocomplete="off">
  </div>

  <div class="section">
    <div class="section-title">Default Tone</div>
    <label for="defaultTone">Tone</label>
    <select id="defaultTone">
      <option value="professional">Professional</option>
      <option value="casual">Casual</option>
      <option value="witty">Witty</option>
      <option value="direct">Direct</option>
    </select>
  </div>

  <div class="section">
    <div class="section-title">Platforms</div>
    <div class="toggle-row">
      <span>LinkedIn</span>
      <label class="toggle">
        <input type="checkbox" id="platform-linkedin" checked>
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="toggle-row">
      <span>Facebook</span>
      <label class="toggle">
        <input type="checkbox" id="platform-facebook" checked>
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="toggle-row">
      <span>X / Twitter</span>
      <label class="toggle">
        <input type="checkbox" id="platform-x" checked>
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="toggle-row">
      <span>Reddit</span>
      <label class="toggle">
        <input type="checkbox" id="platform-reddit" checked>
        <span class="toggle-slider"></span>
      </label>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Recent History</div>
    <div class="history-list" id="historyList">
      <div style="color: #94a3b8; font-size: 12px;">Loading...</div>
    </div>
    <button class="clear-btn" id="clearHistoryBtn">Clear History</button>
  </div>

  <button class="save-btn" id="saveBtn">Save Settings</button>
  <div class="status" id="status">Settings saved!</div>

  <div class="key-hint">
    Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> to trigger AI Copilot on any field
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

- [ ] Write `extension/popup.js`

```javascript
// popup.js
// Settings panel for the Social AI Copilot extension.

(function() {
  'use strict';

  // ── DOM references ──
  var providerSelect = document.getElementById('provider');
  var apiKeyInput = document.getElementById('apiKey');
  var backendTokenInput = document.getElementById('backendToken');
  var backendTokenLabel = document.getElementById('backendTokenLabel');
  var defaultToneSelect = document.getElementById('defaultTone');
  var historyList = document.getElementById('historyList');
  var clearHistoryBtn = document.getElementById('clearHistoryBtn');
  var saveBtn = document.getElementById('saveBtn');
  var statusEl = document.getElementById('status');

  // ── Toggle visibility based on provider ──
  function updateProviderUI() {
    var provider = providerSelect.value;
    if (provider === 'backend') {
      apiKeyInput.style.display = 'none';
      apiKeyInput.previousElementSibling.style.display = 'none'; // label
      backendTokenInput.style.display = 'block';
      backendTokenLabel.style.display = 'block';
    } else {
      apiKeyInput.style.display = 'block';
      apiKeyInput.previousElementSibling.style.display = 'block';
      backendTokenInput.style.display = 'none';
      backendTokenLabel.style.display = 'none';
    }
  }

  providerSelect.addEventListener('change', updateProviderUI);

  // ── Load settings ──
  function loadSettings() {
    chrome.runtime.sendMessage({ type: 'getSettings' }, function(settings) {
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
  saveBtn.addEventListener('click', function() {
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

    chrome.runtime.sendMessage({ type: 'saveSettings', data: data }, function(response) {
      if (response && response.ok) {
        statusEl.classList.add('show');
        setTimeout(function() {
          statusEl.classList.remove('show');
        }, 2000);
      }
    });
  });

  // ── Load history ──
  function loadHistory() {
    chrome.runtime.sendMessage({ type: 'getHistory' }, function(history) {
      if (!history || history.length === 0) {
        historyList.innerHTML = '';
        var emptyEl = document.createElement('div');
        emptyEl.style.color = '#94a3b8';
        emptyEl.style.fontSize = '12px';
        emptyEl.textContent = 'No generation history yet.';
        historyList.appendChild(emptyEl);
        return;
      }

      historyList.innerHTML = '';

      // Show last 10 entries
      var entries = history.slice(0, 10);
      entries.forEach(function(entry) {
        var item = document.createElement('div');
        item.className = 'history-item';

        var text = document.createElement('div');
        text.style.color = '#1e293b';
        text.style.fontWeight = '500';
        text.textContent = (entry.output || '').substring(0, 80) + ((entry.output || '').length > 80 ? '...' : '');
        item.appendChild(text);

        var meta = document.createElement('div');
        meta.className = 'meta';
        var date = new Date(entry.timestamp);
        meta.textContent = (entry.platform || '') + ' / ' + (entry.task || '') + ' / ' + date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        item.appendChild(meta);

        historyList.appendChild(item);
      });
    });
  }

  // ── Clear history ──
  clearHistoryBtn.addEventListener('click', function() {
    if (confirm('Clear all generation history?')) {
      chrome.runtime.sendMessage({ type: 'clearHistory' }, function() {
        loadHistory();
      });
    }
  });

  // ── Initialize ──
  loadSettings();
  loadHistory();
})();
```

## Task 15: Integration, Final Wiring, and Verification

Final steps to ensure all modules work together, the extension loads correctly, and the end-to-end flow is verified.

- [ ] **Create placeholder icons.** Create the directory `extension/icons/` and add three simple PNG placeholder icons (16x16, 48x48, 128x128) with a purple "AI" badge. Use any image tool or download generic icons. The manifest references these paths:

```
extension/icons/icon16.png
extension/icons/icon48.png
extension/icons/icon128.png
```

- [ ] **Verify the complete file tree.** Run `find . -type f` from the project root and confirm every file exists:

```
extension/manifest.json
extension/background.js
extension/content.js
extension/styles.css
extension/popup.html
extension/popup.js
extension/icons/icon16.png
extension/icons/icon48.png
extension/icons/icon128.png
core/aiProvider.js
core/providers/openai.js
core/providers/glm.js
core/providers/backendProxy.js
core/promptBuilder.js
core/contextExtractor.js
core/uiManager.js
utils/dom.js
utils/platform.js
utils/storage.js
```

- [ ] **Test loading the extension in Chrome.**
  1. Open `chrome://extensions/` in Chrome.
  2. Enable "Developer mode" (toggle in the top-right).
  3. Click "Load unpacked" and select the `extension/` directory.
  4. Verify the extension appears with no errors in the extensions page.
  5. Check the service worker (background.js) starts without errors by clicking "service worker" link.

- [ ] **Test the popup.**
  1. Click the extension icon in the Chrome toolbar.
  2. Verify the popup opens with all UI elements: provider dropdown, API key input, tone selector, platform toggles.
  3. Change the provider to "OpenAI", enter a test API key, select "Casual" tone, toggle off Facebook, click "Save Settings".
  4. Reopen the popup and verify all settings persisted correctly.

- [ ] **Test trigger button on LinkedIn.**
  1. Navigate to `https://www.linkedin.com/` (log in if needed).
  2. Click on a post's comment field or the "Start a post" area.
  3. Verify the purple "AI" trigger button appears near the editable field.
  4. Click the trigger button.
  5. Verify the popover opens with action buttons (Reply, Comment, New Post, Rewrite, Expand, Summarize), a tone selector, and a close button.

- [ ] **Test end-to-end AI generation.**
  1. With a valid OpenAI API key saved, click the "Reply" action button in the popover.
  2. Verify the loading state ("Generating...") appears.
  3. Verify the AI response appears in the result area.
  4. Click "Insert" and verify the text is inserted into the editable field.
  5. Open the popup and verify the generation appears in the "Recent History" section.

- [ ] **Test keyboard shortcut.**
  1. Focus an editable field on any supported platform.
  2. Press `Ctrl+Shift+A` (or `Cmd+Shift+A` on Mac).
  3. Verify the popover opens for the active field.

- [ ] **Test error handling.**
  1. Remove the API key in settings and save.
  2. Try to generate a response.
  3. Verify a clear error message appears in the popover (e.g., "Error: OpenAI API key not configured...").

- [ ] **Test platform detection on all four platforms.**
  1. Visit `https://www.linkedin.com/` — verify trigger appears on editable fields.
  2. Visit `https://www.facebook.com/` — verify trigger appears on editable fields.
  3. Visit `https://x.com/` — verify trigger appears on editable fields.
  4. Visit `https://www.reddit.com/` — verify trigger appears on editable fields.

- [ ] **Test platform toggle.**
  1. Open popup, toggle off "X / Twitter", save.
  2. Navigate to `https://x.com/` and focus an editable field.
  3. Verify no trigger button appears.
  4. Re-enable X in settings.

- [ ] **Test history cap.**
  1. Generate more than 100 entries (or temporarily set MAX_HISTORY to 3 in storage.js for testing).
  2. Verify older entries are removed (FIFO behavior).

- [ ] **Security checklist.**
  1. Verify no `innerHTML` is used with user or AI-generated data anywhere in content.js, background.js, or popup.js.
  2. Verify API keys are only stored in `chrome.storage.local` (not in localStorage or cookies).
  3. Verify all API calls originate from `background.js` (service worker), not from content scripts directly.
  4. Verify the manifest only requests `storage`, `activeTab` permissions and host_permissions for the 4 platforms.

- [ ] **Clean up generator scripts.** Remove all `_gen_task*.py` and `write_plan.py` helper scripts from the plans directory:

```bash
rm docs/superpowers/plans/_gen_task*.py
rm docs/superpowers/plans/write_plan.py
```
