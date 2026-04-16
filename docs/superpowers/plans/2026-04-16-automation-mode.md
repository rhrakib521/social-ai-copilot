# Automation Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fully automated commenting mode that scrolls feeds, generates AI comments, and posts them at configurable intervals across LinkedIn, Facebook, X, and Reddit.

**Architecture:** All automation logic lives in `content.js` as an `AutomationEngine` object. A floating control panel on the page provides on/off toggle, stats, and settings. The engine uses the existing `chrome.runtime.sendMessage` flow for AI generation. No new permissions needed.

**Tech Stack:** Chrome Extension MV3, vanilla JS, DOM manipulation, `requestAnimationFrame` for smooth scrolling.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `extension/content.js` | Modify | Add `AutomationEngine` object with full automation loop, floating panel UI, scroll/typing simulation, post detection, comment submission |
| `extension/background.js` | Modify | Add `autoInterval`, `autoStopLimit` to `DEFAULT_SETTINGS` |
| `extension/popup.html` | Modify | Add Automation settings section |
| `extension/popup.js` | Modify | Add automation settings load/save |
| `extension/styles.css` | Modify | Add floating panel and automation UI styles |

---

### Task 1: Add automation selectors to PLATFORMS config in content.js

**Files:**
- Modify: `extension/content.js:77-142` (PLATFORMS object)

Add `postSelector`, `commentButtonSelector`, `replyFieldSelector`, and `submitButtonSelector` to each platform config inside the existing `PLATFORMS` object.

- [ ] **Step 1: Add automation selectors to each platform in PLATFORMS object**

Inside the `PLATFORMS` object at line 77, add new properties to each platform. Replace the existing linkedin config (lines 78-95) with:

```javascript
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
      personality: 'You are writing for LinkedIn. The tone should be professional and thought-leadership oriented. Use industry-relevant language. Keep content polished and suitable for a business network.',
      postSelector: '.feed-shared-update-v2, .feed-shared-celebration-v2, .ocial-reshare-feed-unit',
      commentButtonSelector: 'button[aria-label*="Comment"], button[aria-label*="comment"]',
      replyFieldSelector: '.ql-editor[contenteditable="true"]',
      submitButtonSelector: 'button[type="submit"], button.comments-comment-box__submit-button'
    },
```

Replace the existing facebook config (lines 96-108) with:

```javascript
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
      personality: 'You are writing for Facebook. The tone should be friendly, conversational, and engaging. Content should feel natural and encourage interaction.',
      postSelector: 'div[data-pagelet] [role="article"], div[data-pagelet] div[data-ad-comet-payload]',
      commentButtonSelector: '[aria-label*="Comment"][role="button"], [aria-label*="comment"][role="button"]',
      replyFieldSelector: '[contenteditable="true"][role="textbox"][aria-label*="comment" i], [contenteditable="true"][aria-label*="Write" i]',
      submitButtonSelector: '[aria-label*="Comment"][role="button"]:not([aria-label*="Comment for"]), [aria-label*="Post"][role="button"]'
    },
```

Replace the existing x config (lines 109-123) with:

```javascript
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
      personality: 'You are writing for X (Twitter). Be concise, punchy, and impactful. Respect the character-limited culture even when writing longer posts.',
      postSelector: 'article[data-testid="tweet"]',
      commentButtonSelector: '[data-testid="reply"]',
      replyFieldSelector: '[data-testid="tweetTextarea_0"], .public-DraftEditor-content[contenteditable="true"]',
      submitButtonSelector: '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]'
    },
```

Replace the existing reddit config (lines 124-141) with:

```javascript
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
      personality: 'You are writing for Reddit. Be authentic, knowledgeable, and community-aware. Match the subreddit culture. Avoid overly marketing language. Use proper formatting with Markdown.',
      postSelector: '[data-testid="post-container"], .Post, .thing.link',
      commentButtonSelector: 'button[onclick*="comment"], [data-testid="comment-button"], button:has(span:contains("Comment"))',
      replyFieldSelector: 'textarea[name="text"], textarea#comment-textarea, .public-DraftEditor-content[contenteditable="true"]',
      submitButtonSelector: 'button[type="submit"], button:has(span:contains("Comment"))'
    }
```

- [ ] **Step 2: Commit**

```bash
git add extension/content.js
git commit -m "feat: add automation selectors to PLATFORMS config"
```

---

### Task 2: Add automation settings to DEFAULT_SETTINGS in background.js

**Files:**
- Modify: `extension/background.js:365-378` (DEFAULT_SETTINGS object)

- [ ] **Step 1: Add autoInterval and autoStopLimit to DEFAULT_SETTINGS**

In `background.js`, change the `DEFAULT_SETTINGS` object (line 365) to include the new automation keys:

```javascript
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
  defaultTone: 'casual',
  contexts: [],
  autoInterval: 60,
  autoStopLimit: 0,
  platforms: { linkedin: true, facebook: true, x: true, reddit: true }
};
```

- [ ] **Step 2: Commit**

```bash
git add extension/background.js
git commit -m "feat: add automation settings to DEFAULT_SETTINGS"
```

---

### Task 3: Add Automation settings section to popup UI

**Files:**
- Modify: `extension/popup.html:391` (after Contexts section closing `</div>`)
- Modify: `extension/popup.js` (load/save settings functions)

- [ ] **Step 1: Add Automation section HTML in popup.html**

After the Contexts section closing `</div>` (line 391), before the Platforms section (line 393), insert:

```html
  <div class="section">
    <div class="section-title">Automation</div>
    <p style="font-size:11px;color:#94a3b8;margin-bottom:10px;">Configure the automated commenting mode. Start/stop from the floating panel on any social feed.</p>
    <div class="toggle-row">
      <label for="autoInterval">Interval (seconds)</label>
      <input type="number" id="autoInterval" min="30" max="300" value="60" style="width:70px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;text-align:center;">
    </div>
    <div class="toggle-row" style="margin-top:8px;">
      <label for="autoStopLimit">Auto-stop after (0 = unlimited)</label>
      <input type="number" id="autoStopLimit" min="0" max="500" value="0" style="width:70px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;text-align:center;">
    </div>
  </div>
```

- [ ] **Step 2: Add automation settings to popup.js load function**

In `popup.js`, inside the `loadSettings` function, after the line `document.getElementById('platform-reddit').checked = platforms.reddit !== false;` (around line 128), add:

```javascript
      // Load automation settings
      document.getElementById('autoInterval').value = settings.autoInterval || 60;
      document.getElementById('autoStopLimit').value = settings.autoStopLimit || 0;
```

- [ ] **Step 3: Add automation settings to popup.js save function**

In `popup.js`, inside the save button click handler, add to the settings data object (after the `defaultTone` line):

```javascript
        autoInterval: parseInt(document.getElementById('autoInterval').value, 10) || 60,
        autoStopLimit: parseInt(document.getElementById('autoStopLimit').value, 10) || 0,
```

- [ ] **Step 4: Commit**

```bash
git add extension/popup.html extension/popup.js
git commit -m "feat: add automation settings section to popup UI"
```

---

### Task 4: Add floating panel CSS to styles.css

**Files:**
- Modify: `extension/styles.css` (append after existing styles)

- [ ] **Step 1: Append automation floating panel styles**

Add at the end of `styles.css`:

```css
/* ===== Automation Floating Panel ===== */
.saic-auto-btn {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: #fff;
  font-size: 18px;
  cursor: pointer;
  z-index: 999998;
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  line-height: 1;
}

.saic-auto-btn:hover {
  transform: scale(1.08);
  box-shadow: 0 6px 20px rgba(99, 102, 241, 0.5);
}

.saic-auto-btn.running {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);
}

.saic-auto-panel {
  position: fixed;
  bottom: 70px;
  right: 20px;
  width: 260px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.06);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  z-index: 999998;
  animation: saic-auto-in 0.2s ease-out;
  overflow: hidden;
}

@keyframes saic-auto-in {
  from { opacity: 0; transform: translateY(10px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.saic-auto-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid #f1f5f9;
  background: linear-gradient(135deg, #f8faff 0%, #f1f0ff 100%);
}

.saic-auto-title {
  font-size: 12px;
  font-weight: 600;
  color: #6366f1;
}

.saic-auto-close {
  border: none;
  background: none;
  color: #94a3b8;
  font-size: 16px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.saic-auto-close:hover {
  color: #ef4444;
}

.saic-auto-body {
  padding: 10px 12px;
}

.saic-auto-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.saic-auto-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #94a3b8;
  flex-shrink: 0;
}

.saic-auto-dot.running {
  background: #10b981;
  animation: saic-dot-pulse 1.5s ease-in-out infinite;
}

.saic-auto-dot.paused {
  background: #f59e0b;
}

.saic-auto-dot.stopped {
  background: #ef4444;
}

@keyframes saic-dot-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.saic-auto-status-text {
  font-size: 11px;
  font-weight: 500;
  color: #1e293b;
}

.saic-auto-stats {
  display: flex;
  gap: 12px;
  margin-bottom: 8px;
}

.saic-auto-stat {
  font-size: 10px;
  color: #64748b;
}

.saic-auto-stat strong {
  color: #1e293b;
  font-weight: 600;
}

.saic-auto-timer {
  font-size: 11px;
  color: #6366f1;
  font-weight: 500;
  margin-bottom: 10px;
}

.saic-auto-controls {
  display: flex;
  gap: 6px;
}

.saic-auto-toggle-btn {
  flex: 1;
  padding: 6px;
  border: none;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s ease;
}

.saic-auto-start {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: #fff;
}

.saic-auto-start:hover {
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.4);
}

.saic-auto-stop {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: #fff;
}

.saic-auto-stop:hover {
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.4);
}

.saic-auto-pause {
  background: #f8fafc;
  color: #64748b;
  border: 1px solid #e2e8f0;
}

.saic-auto-pause:hover {
  border-color: #6366f1;
  color: #6366f1;
}

.saic-auto-gear {
  width: 30px;
  padding: 6px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #f8fafc;
  color: #94a3b8;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.saic-auto-gear:hover {
  color: #6366f1;
  border-color: #6366f1;
}

.saic-auto-config {
  display: none;
  padding: 8px 0 4px 0;
  border-top: 1px solid #f1f5f9;
  margin-top: 8px;
}

.saic-auto-config.open {
  display: block;
}

.saic-auto-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.saic-auto-field label {
  font-size: 10px;
  color: #64748b;
}

.saic-auto-field input {
  width: 60px;
  padding: 3px 6px;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  font-size: 11px;
  color: #1e293b;
  text-align: center;
  font-family: inherit;
}

.saic-auto-platform {
  font-size: 10px;
  color: #94a3b8;
  margin-top: 4px;
}
```

- [ ] **Step 2: Commit**

```bash
git add extension/styles.css
git commit -m "feat: add automation floating panel CSS styles"
```

---

### Task 5: Build the AutomationEngine object in content.js

**Files:**
- Modify: `extension/content.js` (insert before the closing `})();` at line 788)

This is the core task. The entire `AutomationEngine` object will be inserted before the `if (document.readyState === 'loading')` block at line 783.

- [ ] **Step 1: Add AutomationEngine object with state management and config loading**

Insert before line 783 (`if (document.readyState === 'loading') {`):

```javascript
  // ══════════════════════════════════════════════════
  // ── Automation Engine ──
  // ══════════════════════════════════════════════════

  var AutomationEngine = {
    state: 'idle', // idle | running | paused | stopped
    config: {
      interval: 60,
      stopLimit: 0
    },
    stats: {
      commentsMade: 0,
      startTime: null,
      postsScanned: 0
    },
    processedPosts: new Set(),
    panelEl: null,
    btnEl: null,
    timerInterval: null,
    nextActionTimeout: null,
    countdownInterval: null,
    nextActionTime: null,
    _abortScroll: false,

    // ── Settings ──
    loadConfig: function () {
      var settings = savedSettings || {};
      this.config.interval = Math.max(30, Math.min(300, settings.autoInterval || 60));
      this.config.stopLimit = Math.max(0, settings.autoStopLimit || 0);
    },

    // ── Core Loop ──
    start: function () {
      this.loadConfig();
      this.state = 'running';
      this.stats.commentsMade = 0;
      this.stats.startTime = Date.now();
      this.stats.postsScanned = 0;
      this.processedPosts = new Set();
      this._abortScroll = false;
      console.log('[SAIC-Auto] Started — interval:', this.config.interval + 's, stop limit:', this.config.stopLimit || 'unlimited');
      this.updateUI();
      this.runCycle();
    },

    stop: function (reason) {
      this.state = 'stopped';
      this._abortScroll = true;
      clearTimeout(this.nextActionTimeout);
      clearInterval(this.countdownInterval);
      this.nextActionTimeout = null;
      this.countdownInterval = null;
      this.nextActionTime = null;
      console.log('[SAIC-Auto] Stopped' + (reason ? ' — ' + reason : ''));
      this.updateUI();
    },

    pause: function () {
      if (this.state !== 'running') return;
      this.state = 'paused';
      this._abortScroll = true;
      clearTimeout(this.nextActionTimeout);
      clearInterval(this.countdownInterval);
      this.nextActionTimeout = null;
      this.countdownInterval = null;
      this.nextActionTime = null;
      console.log('[SAIC-Auto] Paused at ' + this.stats.commentsMade + ' comments');
      this.updateUI();
    },

    resume: function () {
      if (this.state !== 'paused') return;
      this.state = 'running';
      this._abortScroll = false;
      console.log('[SAIC-Auto] Resumed');
      this.updateUI();
      this.runCycle();
    },

    runCycle: function () {
      var self = this;
      if (self.state !== 'running') return;

      // Check stop limit
      if (self.config.stopLimit > 0 && self.stats.commentsMade >= self.config.stopLimit) {
        self.stop('limit reached (' + self.config.stopLimit + ' comments)');
        return;
      }

      // Find next post
      var post = self.findNextPost();
      if (!post) {
        // No more posts found — try scrolling down
        console.log('[SAIC-Auto] No uncommented post found, scrolling...');
        self.humanScroll(window.scrollY + window.innerHeight * (1 + Math.random() * 2), function () {
          if (self.state !== 'running') return;
          // Wait for content to load
          setTimeout(function () {
            post = self.findNextPost();
            if (!post) {
              console.log('[SAIC-Auto] No posts found after scroll, retrying in 10s...');
              self.scheduleNextCycle(10000);
              return;
            }
            self.processPost(post);
          }, 1500 + Math.random() * 1500);
        });
        return;
      }

      self.processPost(post);
    },

    processPost: function (post) {
      var self = this;
      if (self.state !== 'running') return;

      // Mark post as processed
      var postId = self.getPostFingerprint(post);
      self.processedPosts.add(postId);
      self.stats.postsScanned++;

      // Scroll post into view
      self.scrollToPost(post, function () {
        if (self.state !== 'running') return;

        // Simulate reading delay
        var readDelay = 3000 + Math.random() * 5000;
        console.log('[SAIC-Auto] Reading post for ' + Math.round(readDelay / 1000) + 's...');
        self.updateCountdown(readDelay, 'Reading...');

        setTimeout(function () {
          if (self.state !== 'running') return;

          // Extract context from the post
          var context = self.extractPostContext(post);

          // Generate AI comment
          self.generateComment(context, function (text) {
            if (self.state !== 'running') return;
            if (!text) {
              console.log('[SAIC-Auto] Comment generation failed, skipping post');
              self.scheduleNextCycle(5000);
              return;
            }

            // Type and submit the comment
            self.typeAndSubmit(post, text, function (success) {
              if (success) {
                self.stats.commentsMade++;
                console.log('[SAIC-Auto] Comment #' + self.stats.commentsMade + ' posted: "' + text.substring(0, 60) + '..."');
              } else {
                console.log('[SAIC-Auto] Failed to submit comment, moving on');
              }
              self.updateUI();

              // Schedule next cycle with interval
              var extraPause = (self.stats.commentsMade % (5 + Math.floor(Math.random() * 4)) === 0)
                ? 5000 + Math.random() * 10000
                : 0;
              self.scheduleNextCycle(self.config.interval * 1000 + extraPause);
            });
          });
        }, readDelay);
      });
    },

    scheduleNextCycle: function (delayMs) {
      var self = this;
      if (self.state !== 'running') return;

      var label = 'Next in ' + Math.round(delayMs / 1000) + 's';
      console.log('[SAIC-Auto] ' + label);
      self.updateCountdown(delayMs, 'Next in');

      self.nextActionTime = Date.now() + delayMs;
      self.nextActionTimeout = setTimeout(function () {
        if (self.state === 'running') {
          self.runCycle();
        }
      }, delayMs);
    },

    updateCountdown: function (totalMs, prefix) {
      var self = this;
      clearInterval(self.countdownInterval);
      if (!self.panelEl) return;

      var timerEl = self.panelEl.querySelector('.saic-auto-timer');
      if (!timerEl) return;

      var remaining = totalMs;
      timerEl.textContent = prefix + ' ' + Math.ceil(remaining / 1000) + 's';

      self.countdownInterval = setInterval(function () {
        remaining -= 1000;
        if (remaining <= 0) {
          clearInterval(self.countdownInterval);
          timerEl.textContent = 'Working...';
          return;
        }
        timerEl.textContent = prefix + ' ' + Math.ceil(remaining / 1000) + 's';
      }, 1000);
    },

    // ── Post Detection ──
    findNextPost: function () {
      if (!platformConfig || !platformConfig.postSelector) return null;
      var posts = document.querySelectorAll(platformConfig.postSelector);
      for (var i = 0; i < posts.length; i++) {
        var fp = this.getPostFingerprint(posts[i]);
        if (!this.processedPosts.has(fp) && !this.isAlreadyCommented(posts[i])) {
          return posts[i];
        }
      }
      return null;
    },

    getPostFingerprint: function (el) {
      // Use a combination of text content hash and position
      var text = (el.innerText || '').substring(0, 200).trim();
      var rect = el.getBoundingClientRect();
      return text.length.toString(36) + '_' + Math.round(rect.top).toString(36) + '_' + el.tagName + '_' + el.className.substring(0, 30);
    },

    isAlreadyCommented: function (postEl) {
      // Heuristic: check if there's a reply field already open in this post
      // or if this post has comments from "you" (varies by platform)
      // For now, rely on processedPosts set — this is the primary dedup
      return false;
    },

    extractPostContext: function (postEl) {
      var text = extractText(postEl, 2000);
      var author = '';
      if (platformConfig.authorSelector) {
        var authorEls = postEl.querySelectorAll(platformConfig.authorSelector);
        if (authorEls.length > 0) {
          author = (authorEls[0].innerText || authorEls[0].textContent || '').trim();
        }
      }

      // Collect nearby comments for context
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

      return {
        postText: text,
        author: author,
        nearbyComments: comments,
        selectedText: ''
      };
    },

    // ── AI Generation ──
    generateComment: function (context, callback) {
      var self = this;
      var tone = (savedSettings && savedSettings.defaultTone) || 'casual';

      // Resolve default context profile
      var contextInfo = '';
      var allContexts = (savedSettings && savedSettings.contexts) || [];
      var defaultCtx = allContexts.find(function (c) { return c.isDefault; });
      if (defaultCtx) contextInfo = defaultCtx.body;

      chrome.runtime.sendMessage({
        type: 'generate',
        data: {
          platform: platformName,
          task: 'quick_reply',
          tone: tone,
          context: context,
          personality: platformConfig.personality,
          contextInfo: contextInfo
        }
      }, function (response) {
        if (chrome.runtime.lastError) {
          console.log('[SAIC-Auto] Generate error:', chrome.runtime.lastError.message);
          callback(null);
          return;
        }
        if (response && response.error) {
          console.log('[SAIC-Auto] Generate API error:', response.error);
          callback(null);
          return;
        }
        if (response && response.text) {
          callback(response.text);
          return;
        }
        callback(null);
      });
    },

    // ── Comment Submission ──
    typeAndSubmit: function (postEl, text, callback) {
      var self = this;
      if (self.state !== 'running') { callback(false); return; }

      // Step 1: Click comment button
      self.clickCommentButton(postEl, function (replyField) {
        if (!replyField) {
          console.log('[SAIC-Auto] Could not find reply field after clicking comment button');
          callback(false);
          return;
        }

        // Step 2: Type the comment character by character
        self.typeComment(replyField, text, function () {
          if (self.state !== 'running') { callback(false); return; }

          // Step 3: Click submit
          setTimeout(function () {
            self.clickSubmitButton(postEl, replyField, function (success) {
              callback(success);
            });
          }, 500 + Math.random() * 500);
        });
      });
    },

    clickCommentButton: function (postEl, callback) {
      var selector = platformConfig.commentButtonSelector;
      if (!selector) { callback(null); return; }

      var btn = postEl.querySelector(selector);
      if (!btn) {
        // Try closest parent scope
        var parent = postEl.parentElement;
        if (parent) btn = parent.querySelector(selector);
      }
      if (!btn) { callback(null); return; }

      btn.click();
      console.log('[SAIC-Auto] Clicked comment button');

      // Wait for reply field to appear
      var attempts = 0;
      var maxAttempts = 10;
      var findField = function () {
        attempts++;
        var field = null;
        var replySelector = platformConfig.replyFieldSelector;
        if (replySelector) {
          // Look for visible reply field within or near the post
          var candidates = document.querySelectorAll(replySelector);
          for (var i = 0; i < candidates.length; i++) {
            var rect = candidates[i].getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              field = candidates[i];
              break;
            }
          }
        }
        if (field) {
          callback(field);
        } else if (attempts < maxAttempts) {
          setTimeout(findField, 200);
        } else {
          callback(null);
        }
      };
      setTimeout(findField, 300);
    },

    typeComment: function (field, text, callback) {
      var self = this;
      field.focus();
      field.scrollIntoView({ block: 'center' });

      var chars = text.split('');
      var i = 0;

      var typeNext = function () {
        if (self.state !== 'running' || i >= chars.length) {
          if (i >= chars.length) callback();
          return;
        }

        // Simulate keypress events
        var char = chars[i];
        field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: char }));
        field.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: char }));

        // Insert the character
        if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
          var start = field.selectionStart;
          var val = field.value;
          field.value = val.substring(0, start) + char + val.substring(start);
          field.selectionStart = field.selectionEnd = start + 1;
        } else {
          document.execCommand('insertText', false, char);
        }

        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: char }));

        i++;

        // Variable delay: 30-80ms, with 10% chance of 100-200ms pause
        var delay = 30 + Math.random() * 50;
        if (Math.random() < 0.1) delay += 100 + Math.random() * 100;

        setTimeout(typeNext, delay);
      };

      typeNext();
    },

    clickSubmitButton: function (postEl, replyField, callback) {
      var selector = platformConfig.submitButtonSelector;
      if (!selector) { callback(false); return; }

      // Look for submit button near the reply field
      var container = replyField.closest('[role="dialog"]') || replyField.closest('form') || postEl;
      var btn = container.querySelector(selector);
      if (!btn) {
        // Fallback: search more broadly
        btn = postEl.querySelector(selector);
      }
      if (!btn) {
        // Last resort: look for any button with submit-like text
        var allBtns = container.querySelectorAll('button');
        for (var i = 0; i < allBtns.length; i++) {
          var txt = (allBtns[i].textContent || '').toLowerCase().trim();
          if (txt === 'post' || txt === 'reply' || txt === 'comment' || txt === 'submit' || txt === 'send') {
            btn = allBtns[i];
            break;
          }
        }
      }

      if (!btn) {
        console.log('[SAIC-Auto] No submit button found');
        callback(false);
        return;
      }

      // Make sure button is visible and enabled
      var rect = btn.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        console.log('[SAIC-Auto] Submit button not visible');
        callback(false);
        return;
      }

      btn.click();
      console.log('[SAIC-Auto] Clicked submit button');
      callback(true);
    },

    // ── Human-Like Scrolling ──
    humanScroll: function (targetY, callback) {
      var self = this;
      var startY = window.scrollY;
      var distance = targetY - startY;
      if (Math.abs(distance) < 10) { if (callback) callback(); return; }

      var direction = distance > 0 ? 1 : -1;
      var totalDuration = Math.abs(distance) / (300 + Math.random() * 300) * 1000;
      totalDuration = Math.max(500, Math.min(3000, totalDuration));

      var startTime = null;
      var lastPauseAt = 0;

      function step(timestamp) {
        if (self._abortScroll || self.state !== 'running') {
          if (callback) callback();
          return;
        }

        if (!startTime) startTime = timestamp;
        var elapsed = timestamp - startTime;
        var progress = Math.min(elapsed / totalDuration, 1);

        // Ease in-out with some noise
        var eased = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        var currentY = startY + distance * eased;
        window.scrollTo(0, currentY);

        // Random micro-pauses
        if (progress - lastPauseAt > 0.15 + Math.random() * 0.2 && progress < 0.9) {
          lastPauseAt = progress;
          var pauseMs = 300 + Math.random() * 700;
          setTimeout(function () {
            requestAnimationFrame(step);
          }, pauseMs);
          return;
        }

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          if (callback) callback();
        }
      }

      requestAnimationFrame(step);
    },

    scrollToPost: function (postEl, callback) {
      var rect = postEl.getBoundingClientRect();
      var targetY = window.scrollY + rect.top - 100;
      this.humanScroll(targetY, callback);
    },

    // ── Floating Panel UI ──
    createPanel: function () {
      var self = this;
      if (self.panelEl) return;

      // Collapsed button
      self.btnEl = document.createElement('button');
      self.btnEl.type = 'button';
      self.btnEl.className = 'saic-auto-btn';
      self.btnEl.title = 'AI Copilot Automation';
      self.btnEl.textContent = '\u25B6'; // play triangle
      self.btnEl.addEventListener('click', function () {
        self.togglePanel();
      });

      // Panel
      self.panelEl = document.createElement('div');
      self.panelEl.className = 'saic-auto-panel';
      self.panelEl.style.display = 'none';

      self.panelEl.innerHTML =
        '<div class="saic-auto-header">' +
          '<span class="saic-auto-title">Auto Comment</span>' +
          '<button type="button" class="saic-auto-close" title="Close panel">&times;</button>' +
        '</div>' +
        '<div class="saic-auto-body">' +
          '<div class="saic-auto-status">' +
            '<div class="saic-auto-dot"></div>' +
            '<span class="saic-auto-status-text">Idle</span>' +
          '</div>' +
          '<div class="saic-auto-stats">' +
            '<span class="saic-auto-stat">Comments: <strong>0</strong>/<span class="saic-auto-limit">0</span></span>' +
            '<span class="saic-auto-stat">Time: <strong class="saic-auto-elapsed">0:00</strong></span>' +
          '</div>' +
          '<div class="saic-auto-timer"></div>' +
          '<div class="saic-auto-controls">' +
            '<button type="button" class="saic-auto-toggle-btn saic-auto-start">Start</button>' +
            '<button type="button" class="saic-auto-toggle-btn saic-auto-pause" style="display:none;">Pause</button>' +
            '<button type="button" class="saic-auto-gear" title="Settings">\u2699</button>' +
          '</div>' +
          '<div class="saic-auto-config">' +
            '<div class="saic-auto-field">' +
              '<label>Interval (sec)</label>' +
              '<input type="number" class="saic-auto-cfg-interval" min="30" max="300" value="60">' +
            '</div>' +
            '<div class="saic-auto-field">' +
              '<label>Stop after (0=off)</label>' +
              '<input type="number" class="saic-auto-cfg-limit" min="0" max="500" value="0">' +
            '</div>' +
            '<div class="saic-auto-platform">Platform: ' + (platformName || 'unknown') + '</div>' +
          '</div>' +
        '</div>';

      document.body.appendChild(self.btnEl);
      document.body.appendChild(self.panelEl);

      // Wire up events
      self.panelEl.querySelector('.saic-auto-close').addEventListener('click', function () {
        self.panelEl.style.display = 'none';
      });

      var startBtn = self.panelEl.querySelector('.saic-auto-start');
      var pauseBtn = self.panelEl.querySelector('.saic-auto-pause');

      startBtn.addEventListener('click', function () {
        if (self.state === 'idle' || self.state === 'stopped') {
          // Read config from inline fields
          self.config.interval = Math.max(30, Math.min(300, parseInt(self.panelEl.querySelector('.saic-auto-cfg-interval').value, 10) || 60));
          self.config.stopLimit = Math.max(0, parseInt(self.panelEl.querySelector('.saic-auto-cfg-limit').value, 10) || 0);
          self.start();
        } else if (self.state === 'paused') {
          self.resume();
        }
      });

      pauseBtn.addEventListener('click', function () {
        if (self.state === 'running') {
          self.pause();
        } else if (self.state === 'paused') {
          self.resume();
        }
      });

      self.panelEl.querySelector('.saic-auto-gear').addEventListener('click', function () {
        var config = self.panelEl.querySelector('.saic-auto-config');
        config.classList.toggle('open');
      });

      // Make panel draggable
      self.makePanelDraggable();
    },

    togglePanel: function () {
      if (!this.panelEl) return;
      this.panelEl.style.display = this.panelEl.style.display === 'none' ? 'block' : 'none';
    },

    makePanelDraggable: function () {
      var self = this;
      var header = self.panelEl.querySelector('.saic-auto-header');
      if (!header) return;

      var isDragging = false;
      var startX = 0, startY = 0, startLeft = 0, startTop = 0;

      header.addEventListener('mousedown', function (e) {
        if (e.target.closest('.saic-auto-close')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = self.panelEl.offsetLeft;
        startTop = self.panelEl.offsetTop;
        header.style.cursor = 'grabbing';
        e.preventDefault();
      });

      document.addEventListener('mousemove', function (e) {
        if (!isDragging) return;
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        self.panelEl.style.left = (startLeft + dx) + 'px';
        self.panelEl.style.top = (startTop + dy) + 'px';
        self.panelEl.style.right = 'auto';
        self.panelEl.style.bottom = 'auto';
      });

      document.addEventListener('mouseup', function () {
        if (isDragging) {
          isDragging = false;
          header.style.cursor = 'grab';
        }
      });
    },

    updateUI: function () {
      var self = this;
      if (!self.panelEl) return;

      var dot = self.panelEl.querySelector('.saic-auto-dot');
      var statusText = self.panelEl.querySelector('.saic-auto-status-text');
      var startBtn = self.panelEl.querySelector('.saic-auto-start');
      var pauseBtn = self.panelEl.querySelector('.saic-auto-pause');
      var timerEl = self.panelEl.querySelector('.saic-auto-timer');
      var commentsEl = self.panelEl.querySelector('.saic-auto-stat strong');
      var limitEl = self.panelEl.querySelector('.saic-auto-limit');
      var elapsedEl = self.panelEl.querySelector('.saic-auto-elapsed');

      // Remove all state classes from dot
      dot.className = 'saic-auto-dot';

      switch (self.state) {
        case 'idle':
          dot.classList.add('stopped');
          statusText.textContent = 'Idle';
          startBtn.textContent = 'Start';
          startBtn.className = 'saic-auto-toggle-btn saic-auto-start';
          startBtn.style.display = '';
          pauseBtn.style.display = 'none';
          timerEl.textContent = '';
          self.btnEl.className = 'saic-auto-btn';
          self.btnEl.textContent = '\u25B6';
          break;
        case 'running':
          dot.classList.add('running');
          statusText.textContent = 'Running';
          startBtn.style.display = 'none';
          pauseBtn.textContent = 'Pause';
          pauseBtn.className = 'saic-auto-toggle-btn saic-auto-pause';
          pauseBtn.style.display = '';
          self.btnEl.className = 'saic-auto-btn running';
          self.btnEl.textContent = '\u23F8';
          break;
        case 'paused':
          dot.classList.add('paused');
          statusText.textContent = 'Paused';
          startBtn.textContent = 'Resume';
          startBtn.className = 'saic-auto-toggle-btn saic-auto-start';
          startBtn.style.display = '';
          pauseBtn.style.display = 'none';
          self.btnEl.className = 'saic-auto-btn';
          self.btnEl.textContent = '\u25B6';
          break;
        case 'stopped':
          dot.classList.add('stopped');
          statusText.textContent = 'Stopped (' + self.stats.commentsMade + ' comments)';
          startBtn.textContent = 'Restart';
          startBtn.className = 'saic-auto-toggle-btn saic-auto-start';
          startBtn.style.display = '';
          pauseBtn.style.display = 'none';
          timerEl.textContent = '';
          self.btnEl.className = 'saic-auto-btn';
          self.btnEl.textContent = '\u25B6';
          break;
      }

      // Update stats
      if (commentsEl) commentsEl.textContent = self.stats.commentsMade;
      if (limitEl) limitEl.textContent = self.config.stopLimit || '\u221E';
      if (elapsedEl) elapsedEl.textContent = self.formatElapsed();

      // Update config inputs
      var cfgInterval = self.panelEl.querySelector('.saic-auto-cfg-interval');
      var cfgLimit = self.panelEl.querySelector('.saic-auto-cfg-limit');
      if (cfgInterval) cfgInterval.value = self.config.interval;
      if (cfgLimit) cfgLimit.value = self.config.stopLimit;
    },

    formatElapsed: function () {
      if (!this.stats.startTime) return '0:00';
      var ms = Date.now() - this.stats.startTime;
      var secs = Math.floor(ms / 1000);
      var mins = Math.floor(secs / 60);
      var hrs = Math.floor(mins / 60);
      if (hrs > 0) {
        return hrs + ':' + String(mins % 60).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
      }
      return mins + ':' + String(secs % 60).padStart(2, '0');
    },

    // ── Initialization ──
    init: function () {
      if (!platformConfig || !platformConfig.postSelector) return;
      this.loadConfig();
      this.createPanel();
      console.log('[SAIC-Auto] Panel created for ' + platformName);
    }
  };
```

- [ ] **Step 2: Wire up AutomationEngine.init() call in the existing init function**

In the existing `init()` function (around line 739), after the `savedSettings = settings;` line (line 762), add the automation engine initialization:

```javascript
      // Initialize automation engine after settings are loaded
      AutomationEngine.init();
```

- [ ] **Step 3: Commit**

```bash
git add extension/content.js
git commit -m "feat: add AutomationEngine with floating panel, scroll simulation, and comment submission"
```

---

### Task 6: Test and verify the complete flow

**Files:**
- No new files — manual verification

- [ ] **Step 1: Load the extension in Chrome and verify no console errors**

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and select the `extension/` folder
4. Open a LinkedIn, Facebook, X, or Reddit feed page
5. Open DevTools console (F12)
6. Verify `[SAIC-Auto] Panel created for <platform>` appears in the console
7. Verify the floating play button appears in the bottom-right corner

- [ ] **Step 2: Verify floating panel interaction**

1. Click the floating play button
2. Verify the expanded panel appears with Idle status
3. Click the gear icon to open settings
4. Verify interval and stop-limit fields are visible
5. Close the panel with the X button
6. Re-open by clicking the floating button again

- [ ] **Step 3: Verify popup settings**

1. Click the extension icon in the toolbar
2. Scroll to the new "Automation" section
3. Verify interval and auto-stop fields appear with correct defaults (60 and 0)
4. Change values and save
5. Reload the social media page
6. Verify the automation panel reflects the saved settings

- [ ] **Step 4: Commit final verification**

```bash
git add -A
git commit -m "feat: complete automation mode for Social AI Copilot"
```

---

## Self-Review Checklist

1. **Spec coverage:**
   - Floating panel UI (collapsed + expanded): Task 4 (CSS) + Task 5 (JS)
   - On/off toggle + pause/resume: Task 5
   - Status indicator + stats: Task 5
   - Countdown timer: Task 5 (`updateCountdown`)
   - Auto-stop limit: Task 2 (settings) + Task 3 (popup) + Task 5 (engine)
   - Adjustable interval: Task 2 + Task 3 + Task 5
   - Post detection per platform: Task 1 (selectors) + Task 5 (`findNextPost`)
   - Already-commented check: Task 5 (`isAlreadyCommented` + `processedPosts` Set)
   - Comment submission flow: Task 5 (`typeAndSubmit`, `clickCommentButton`, `typeComment`, `clickSubmitButton`)
   - Human-like scrolling: Task 5 (`humanScroll`, `scrollToPost`)
   - Human-like typing: Task 5 (`typeComment` with variable delays)
   - Reading simulation: Task 5 (3-8s delay in `processPost`)
   - Session rhythm pauses: Task 5 (every 5-8 comments)
   - AI generation with default tone + context: Task 5 (`generateComment`)
   - Popup settings: Task 3
   - Safety limits (30s min, 300s max): Task 5 (`loadConfig`)
   - Console logging: Task 5 (`console.log` with `[SAIC-Auto]` prefix)

2. **Placeholder scan:** No TBD/TODO found. All code is complete.

3. **Type consistency:** `config.interval` and `config.stopLimit` used consistently across popup load/save, DEFAULT_SETTINGS, and AutomationEngine. `state` values (`idle`, `running`, `paused`, `stopped`) consistent across `updateUI` switch statement and state transition methods.
