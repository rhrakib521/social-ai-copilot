# Reddit Automation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Reddit-specific automation engine that produces natural, helpful, human-like comments in business-relevant subreddits with maximum anti-detection safety.

**Architecture:** `RedditAutoEngine` object in content.js runs when platform is Reddit. It overrides the generic `AutomationEngine` cycle with subreddit targeting, behavioral biometrics (Bezier mouse, variable typing), safety checks, and smart business mention injection. Prompt changes in background.js add the `reddit_auto_comment` task. Popup UI adds subreddit targeting, business identity, and safety settings.

**Tech Stack:** Chrome Extension (Manifest V3), vanilla JS, Chrome Storage API, Web Worker timers.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `extension/background.js` | AI prompt generation, settings defaults, message handling |
| `extension/content.js` | RedditAutoEngine, behavioral biometrics, automation flow |
| `extension/popup.html` | Reddit panel UI with new settings sections |
| `extension/popup.js` | Load/save Reddit-specific settings |

---

### Task 1: Add Reddit-Specific Defaults to background.js

**Files:**
- Modify: `extension/background.js:417-464` (DEFAULT_PLATFORM_SETTINGS and DEFAULT_SETTINGS)
- Modify: `extension/background.js:466-498` (migrateSettings)

- [ ] **Step 1: Add Reddit defaults to DEFAULT_PLATFORM_SETTINGS**

In `extension/background.js`, the `DEFAULT_PLATFORM_SETTINGS` object at line 417 does not include Reddit-specific fields. After line 430 (`mentionPages: []`), the Reddit entry in `DEFAULT_SETTINGS` (line 459) spreads these defaults. We need Reddit-only fields added only to the Reddit entry.

Replace the Reddit entry in `DEFAULT_SETTINGS.platformSettings` (lines 459-462):

```javascript
    reddit: {
      ...DEFAULT_PLATFORM_SETTINGS,
      engagementThresholds: { minUpvotes: 50, minComments: 10 },
      // Reddit-specific defaults
      targetSubreddits: [],
      blacklistSubreddits: [],
      autoDetectGenre: true,
      businessName: '',
      businessDescription: '',
      mentionFrequency: 15,
      maxCommentsPerHour: 3,
      skipNewPostsMinutes: 60,
      skipBotRestrictedSubs: true
    }
```

- [ ] **Step 2: Add Reddit fields to migrateSettings**

In `extension/background.js`, the `migrateSettings` function at line 466 handles adding missing fields to existing settings. After the existing `customInstructions` check (line 474-476), add Reddit-specific field migration inside the same `platforms.forEach` loop.

After line 476 (`stored.platformSettings[p].customInstructions = '';`), add:

```javascript
      // Reddit-specific migration
      if (p === 'reddit') {
        if (!stored.platformSettings[p].targetSubreddits) stored.platformSettings[p].targetSubreddits = [];
        if (!stored.platformSettings[p].blacklistSubreddits) stored.platformSettings[p].blacklistSubreddits = [];
        if (stored.platformSettings[p].autoDetectGenre === undefined) stored.platformSettings[p].autoDetectGenre = true;
        if (stored.platformSettings[p].businessName === undefined) stored.platformSettings[p].businessName = '';
        if (stored.platformSettings[p].businessDescription === undefined) stored.platformSettings[p].businessDescription = '';
        if (stored.platformSettings[p].mentionFrequency === undefined) stored.platformSettings[p].mentionFrequency = 15;
        if (stored.platformSettings[p].maxCommentsPerHour === undefined) stored.platformSettings[p].maxCommentsPerHour = 3;
        if (stored.platformSettings[p].skipNewPostsMinutes === undefined) stored.platformSettings[p].skipNewPostsMinutes = 60;
        if (stored.platformSettings[p].skipBotRestrictedSubs === undefined) stored.platformSettings[p].skipBotRestrictedSubs = true;
      }
```

- [ ] **Step 3: Commit**

```bash
git add extension/background.js
git commit -m "feat: add Reddit-specific settings defaults and migration"
```

---

### Task 2: Add Reddit Auto Comment Prompt to background.js

**Files:**
- Modify: `extension/background.js:288-300` (TASK_INSTRUCTIONS)
- Modify: `extension/background.js:355-382` (buildPrompt Reddit personality and business mention injection)

- [ ] **Step 1: Add reddit_auto_comment task instruction**

In `extension/background.js`, the `TASK_INSTRUCTIONS` object ends at line 300 with the `auto_classify_comment` entry. Add a new entry after line 300:

```javascript
  reddit_auto_comment: 'STEP 1 — CLASSIFY: Read the post. Is it about SaaS, e-commerce, startups, business, marketing, product development, entrepreneurship, tech tools, or business problems/solutions? If clearly personal (memes, hobbies, gossip, politics, personal life), respond with exactly and only the word SKIP.\nSTEP 2 — SAFETY CHECK: Is this post controversial, a heated debate, political, or emotionally charged? If yes, respond with exactly and only the word SKIP.\nSTEP 3 — COMMENT: Write a helpful, genuine comment. Keep it 3-4 lines normally, 6-7 lines when naturally sharing a longer experience. Sound like a real Redditor who genuinely wants to help. Match the subreddit vibe. Offer specific advice, share relevant experience, or ask a thoughtful follow-up. NO marketing language, NO pitches, NO call-to-action. Use simple conversational English, like chatting with a peer. Start naturally — react to what they said, never start with generic praise. Do NOT address the author by name.'
```

- [ ] **Step 2: Update buildPrompt to use Reddit-specific personality and business mention**

In `extension/background.js`, the `buildPrompt` function at line 302 builds the system prompt. We need to:
1. Override the personality string when task is `reddit_auto_comment`
2. Inject business mention instructions when `mentionMode` flag is passed in the data

After line 314 (`systemLines.push('');`), the personality is already injected. We need to add conditional logic for Reddit.

Replace the personality injection. After line 313 (`'Tone: ' + toneGuide`), before the context injection block (line 318), add:

```javascript
  // Reddit-specific: inject business mention mode
  if (mentionMode && mentionMode.active) {
    systemLines.push('');
    systemLines.push('BUSINESS MENTION MODE ACTIVE:');
    systemLines.push('This post is asking for recommendations, expressing frustration with a solution, or asking how to do something your business covers.');
    systemLines.push('You may briefly mention your experience with ' + (mentionMode.businessName || 'our tool') + ' as a personal anecdote. For example: "I switched to ' + (mentionMode.businessName || 'our tool') + ' a while back and it handles X pretty well" or "we use ' + (mentionMode.businessName || 'our tool') + ' for this at our startup".');
    systemLines.push('Keep it casual, like a side note in a helpful comment. The mention should be 1 line within a 6-7 line comment. The rest must be genuinely helpful advice.');
    if (mentionMode.businessDescription) {
      systemLines.push('Business: ' + mentionMode.businessName + ' — ' + mentionMode.businessDescription);
    }
  }
```

This requires the `mentionMode` parameter to be passed through. The `buildPrompt` function signature at line 302 needs updating:

Change line 302 from:
```javascript
function buildPrompt(platform, task, tone, context, personality, contextInfo, mentionPages, instructionPresets, customInstructions) {
```
to:
```javascript
function buildPrompt(platform, task, tone, context, personality, contextInfo, mentionPages, instructionPresets, customInstructions, mentionMode) {
```

- [ ] **Step 3: Update the generate message handler to pass mentionMode**

In `extension/background.js`, find the `generate` message handler (search for `type: 'generate'`). The handler calls `buildPrompt(...)` with the data from the content script. Add `mentionMode` pass-through.

The handler destructures or accesses `data.mentionPages`, `data.instructionPresets`, etc. Add `mentionMode` to the data passed from content.js and received here. The handler line that calls `buildPrompt` needs `data.mentionMode` appended as the last argument.

- [ ] **Step 4: Commit**

```bash
git add extension/background.js
git commit -m "feat: add Reddit auto-comment prompt and business mention injection"
```

---

### Task 3: Add Reddit Settings UI to popup.html

**Files:**
- Modify: `extension/popup.html:748-754` (before closing `</div>` of Reddit panel, after Mention Pages section)

- [ ] **Step 1: Add Subreddit Targeting section**

In `extension/popup.html`, before the closing `</div>` of the Reddit panel (line 754, which is `</div>` closing `panel-reddit`), add three new sections.

After the Mention Pages section closing `</div>` (line 753), before line 754, insert:

```html
    <div class="section">
      <div class="section-title">Subreddit Targeting</div>
      <label for="ps-reddit-targetSubreddits" style="font-size:11px;">Target subreddits (one per line, without r/)</label>
      <textarea id="ps-reddit-targetSubreddits" rows="3" placeholder="SaaS&#10;startups&#10;ecommerce&#10;Entrepreneur" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:11px;color:#1e293b;font-family:inherit;resize:vertical;box-sizing:border-box;"></textarea>
      <label for="ps-reddit-blacklistSubreddits" style="font-size:11px;margin-top:8px;">Blacklist subreddits (never comment in these)</label>
      <textarea id="ps-reddit-blacklistSubreddits" rows="2" placeholder="PoliticalDiscussion&#10;dankmemes" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:11px;color:#1e293b;font-family:inherit;resize:vertical;box-sizing:border-box;"></textarea>
      <div class="toggle-row" style="margin-top:8px;">
        <label for="ps-reddit-autoDetectGenre" style="font-size:11px;">Auto-detect genre beyond whitelist</label>
        <label class="toggle"><input type="checkbox" id="ps-reddit-autoDetectGenre" checked><span class="toggle-slider"></span></label>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Business Identity</div>
      <p style="font-size:11px;color:#94a3b8;margin-bottom:8px;">Used for rare subtle mentions positioned as personal experience.</p>
      <label for="ps-reddit-businessName" style="font-size:11px;">Business name</label>
      <input type="text" id="ps-reddit-businessName" placeholder="e.g. Periscale" style="width:100%;padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;box-sizing:border-box;">
      <label for="ps-reddit-businessDescription" style="font-size:11px;margin-top:8px;">What does it do? (1-2 sentences)</label>
      <textarea id="ps-reddit-businessDescription" rows="2" placeholder="AI-powered social media automation tool for businesses" style="width:100%;padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;resize:vertical;box-sizing:border-box;"></textarea>
      <div class="toggle-row" style="margin-top:8px;">
        <label for="ps-reddit-mentionFrequency" style="font-size:11px;">Mention frequency: <span id="ps-reddit-mentionFrequencyValue">15</span>%</label>
        <input type="range" id="ps-reddit-mentionFrequency" min="0" max="100" value="15" style="width:100%;">
      </div>
    </div>
    <div class="section">
      <div class="section-title">Safety Settings</div>
      <div class="toggle-row">
        <label for="ps-reddit-maxCommentsPerHour" style="font-size:11px;">Max comments/hour: <span id="ps-reddit-maxCommentsPerHourValue">3</span></label>
        <input type="range" id="ps-reddit-maxCommentsPerHour" min="1" max="10" value="3" style="width:100%;">
      </div>
      <div class="toggle-row" style="margin-top:8px;">
        <label for="ps-reddit-skipNewPostsMinutes" style="font-size:11px;">Skip posts newer than (minutes)</label>
        <input type="number" id="ps-reddit-skipNewPostsMinutes" min="10" max="1440" value="60" style="width:70px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#1e293b;text-align:center;">
      </div>
      <div class="toggle-row" style="margin-top:8px;">
        <label for="ps-reddit-skipBotRestrictedSubs" style="font-size:11px;">Auto-skip bot-restricted subreddits</label>
        <label class="toggle"><input type="checkbox" id="ps-reddit-skipBotRestrictedSubs" checked><span class="toggle-slider"></span></label>
      </div>
    </div>
```

- [ ] **Step 2: Add slider value update scripts**

In `extension/popup.js`, at the end of the `loadSettings()` function (after line 304, before the closing `});`), add event listeners for the slider value displays:

```javascript
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
```

- [ ] **Step 3: Commit**

```bash
git add extension/popup.html extension/popup.js
git commit -m "feat: add Reddit subreddit targeting, business identity, and safety settings UI"
```

---

### Task 4: Wire Reddit Settings Load/Save in popup.js

**Files:**
- Modify: `extension/popup.js:279-284` (loadSettings Reddit section)
- Modify: `extension/popup.js:318-345` (save Reddit section)

- [ ] **Step 1: Load Reddit-specific settings**

In `extension/popup.js`, the loadSettings function loads Reddit threshold values at lines 279-284. After the threshold loading block (after line 283 `if (rcEl) rcEl.value = thresholds.minComments || 10;`), inside the `platform === 'reddit'` block, add:

```javascript
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
```

- [ ] **Step 2: Save Reddit-specific settings**

In `extension/popup.js`, the save handler builds `platformSettings[platform]` at line 326. For Reddit, after line 344 (`mentionPages: mentionPages`), we need to add the Reddit-specific fields. Change the Reddit section to conditionally include extra fields.

Replace lines 326-345. The current code builds the object uniformly for all platforms. After the closing of the platformSettings[platform] object (line 345 `};`), add Reddit-specific fields conditionally:

```javascript
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
```

- [ ] **Step 3: Commit**

```bash
git add extension/popup.js
git commit -m "feat: wire Reddit-specific settings load/save in popup"
```

---

### Task 5: Add RedditAutoEngine Core to content.js

**Files:**
- Modify: `extension/content.js` — add `RedditAutoEngine` object after the `AutomationEngine` object (after line 2160, before the init block that creates the control panel)

This is the largest task. The `RedditAutoEngine` sits alongside the existing `AutomationEngine` and takes over when the platform is Reddit.

- [ ] **Step 1: Add RedditAutoEngine object skeleton and init**

After the `AutomationEngine` object's closing (find the last method of `AutomationEngine`, which is `initPanel` or similar), add the `RedditAutoEngine` object. Insert before the `AutomationEngine.init()` call or the control panel creation.

```javascript
  // ══════════════════════════════════════════════════
  // ── Reddit Automation Engine ──
  // ══════════════════════════════════════════════════

  var RedditAutoEngine = {
    // State
    active: false,
    commentTimestamps: [],    // { timestamp, subreddit } for rate limiting
    subredditCooldowns: {},   // subreddit → lastCommentTimestamp
    blockedSubreddits: new Set(),
    recentOpenings: [],       // last 10 comment first-lines for dedup
    mentionCount: 0,
    totalComments: 0,
    coffeeBreakAfter: 0,     // comments until next coffee break
    coffeeBreakCounter: 0,

    // Load Reddit-specific config from savedSettings
    loadConfig: function () {
      var settings = savedSettings || {};
      var ps = (settings.platformSettings && settings.platformSettings.reddit) || {};
      this.config = {
        targetSubreddits: (ps.targetSubreddits || []).map(function (s) { return s.toLowerCase().replace(/^r\//, ''); }),
        blacklistSubreddits: (ps.blacklistSubreddits || []).map(function (s) { return s.toLowerCase().replace(/^r\//, ''); }),
        autoDetectGenre: ps.autoDetectGenre !== false,
        businessName: ps.businessName || '',
        businessDescription: ps.businessDescription || '',
        mentionFrequency: ps.mentionFrequency !== undefined ? ps.mentionFrequency : 15,
        maxCommentsPerHour: ps.maxCommentsPerHour || 3,
        skipNewPostsMinutes: ps.skipNewPostsMinutes || 60,
        skipBotRestrictedSubs: ps.skipBotRestrictedSubs !== false,
        interval: Math.max(60, Math.min(300, ps.interval || 90)),
        stopLimit: ps.stopLimit || 0,
        autoSubmit: ps.autoSubmit !== false
      };
      this.coffeeBreakAfter = 3 + Math.floor(Math.random() * 3); // 3-5 comments
    },

    // Hook into AutomationEngine — called from AutomationEngine.runCycle when platform is reddit
    shouldActivate: function () {
      return platformName === 'reddit' && AutomationEngine.state === 'running';
    },

    // Extract subreddit name from a post element
    extractSubreddit: function (postEl) {
      if (!platformConfig || !platformConfig.subredditSelector) return '';
      var subEl = postEl.querySelector(platformConfig.subredditSelector);
      if (!subEl) {
        // Try parent element
        var parent = postEl.parentElement;
        if (parent) subEl = parent.querySelector(platformConfig.subredditSelector);
      }
      if (!subEl) return '';
      var href = (subEl.getAttribute('href') || '').toLowerCase();
      // Extract subreddit name from href like /r/SaaS/
      var match = href.match(/\/r\/([a-zA-Z0-9_]+)/);
      return match ? match[1].toLowerCase() : '';
    },

    // Check if a subreddit is a valid target
    isSubredditTarget: function (subreddit) {
      if (!subreddit) return false;
      // Check blacklist first
      if (this.config.blacklistSubreddits.indexOf(subreddit) !== -1) return false;
      // Check blocked (bot-restricted) cache
      if (this.blockedSubreddits.has(subreddit)) return false;
      // Check whitelist
      if (this.config.targetSubreddits.length > 0 && this.config.targetSubreddits.indexOf(subreddit) !== -1) return true;
      // If no whitelist defined and autoDetectGenre is on, allow
      if (this.config.targetSubreddits.length === 0 && this.config.autoDetectGenre) return true;
      // Auto-detect for non-whitelisted subs
      if (this.config.autoDetectGenre) return true;
      return false;
    },

    // Check subreddit cooldown (max 2 per sub per hour, no consecutive same-sub)
    checkSubredditCooldown: function (subreddit) {
      var now = Date.now();
      var oneHourAgo = now - 3600000;
      // Count comments in this subreddit in the last hour
      var subCount = 0;
      for (var i = 0; i < this.commentTimestamps.length; i++) {
        if (this.commentTimestamps[i].subreddit === subreddit && this.commentTimestamps[i].timestamp > oneHourAgo) {
          subCount++;
        }
      }
      if (subCount >= 2) return false; // Max 2 per sub per hour
      // Check not same sub as last comment
      if (this.commentTimestamps.length > 0) {
        var lastSub = this.commentTimestamps[this.commentTimestamps.length - 1].subreddit;
        if (lastSub === subreddit) {
          // If only 1 target sub, enforce 5-minute gap
          if (this.config.targetSubreddits.length <= 1) {
            var lastTime = this.commentTimestamps[this.commentTimestamps.length - 1].timestamp;
            if (now - lastTime < 300000) return false;
          } else {
            return false; // Don't comment in same sub consecutively
          }
        }
      }
      return true;
    },

    // Check global rate limit
    checkRateLimit: function () {
      var now = Date.now();
      var oneHourAgo = now - 3600000;
      // Clean old timestamps
      this.commentTimestamps = this.commentTimestamps.filter(function (t) { return t.timestamp > oneHourAgo; });
      return this.commentTimestamps.length < this.config.maxCommentsPerHour;
    },

    // Check bot-restriction keywords in subreddit sidebar/rules
    checkSubredditRules: function (subreddit, callback) {
      var self = this;
      if (!self.config.skipBotRestrictedSubs) { callback(true); return; }
      if (self.blockedSubreddits.has(subreddit)) { callback(false); return; }
      // Check for sidebar rules in the DOM
      var BOT_KEYWORDS = ['no bots', 'no automated', 'no ai', 'no self-promo', 'human only', 'manual posts only', 'no automated posting', 'bot-free'];
      var sidebarEl = document.querySelector('.sidebar, .side, [data-testid="sidebar"], .reddit-sidebar');
      if (!sidebarEl) {
        // Try rules page content if visible
        sidebarEl = document.querySelector('.rules-page, [data-testid="rules"]');
      }
      if (sidebarEl) {
        var rulesText = (sidebarEl.innerText || '').toLowerCase();
        for (var i = 0; i < BOT_KEYWORDS.length; i++) {
          if (rulesText.indexOf(BOT_KEYWORDS[i]) !== -1) {
            self.blockedSubreddits.add(subreddit);
            AutomationEngine.addLog('Blocked subreddit: r/' + subreddit + ' (bot restriction detected)');
            callback(false);
            return;
          }
        }
      }
      callback(true);
    },

    // Check if we should mention business for this post
    shouldMentionBusiness: function (postContext) {
      if (!this.config.businessName) return false;
      // Check mention budget
      if (this.totalComments === 0) return false;
      var mentionRate = (this.mentionCount / this.totalComments) * 100;
      if (mentionRate >= this.config.mentionFrequency) return false;
      return true;
    },

    // Calculate next action delay with Reddit-specific randomization
    getRedditDelay: function () {
      var base = this.config.interval * 1000;
      // Heavy randomization: 0.7x to 1.6x base
      var multiplier = 0.7 + Math.random() * 0.9;
      var delay = base * multiplier;
      // Add jitter ±20%
      delay = jitter(delay, 0.2);
      // Coffee break check
      this.coffeeBreakCounter++;
      if (this.coffeeBreakCounter >= this.coffeeBreakAfter) {
        var breakMs = jitter(randomBetween(180000, 480000), 0.2); // 3-8 min
        AutomationEngine.addLog('Coffee break: ' + Math.round(breakMs / 1000) + 's');
        delay += breakMs;
        this.coffeeBreakCounter = 0;
        this.coffeeBreakAfter = 3 + Math.floor(Math.random() * 3);
      }
      return delay;
    },

    // Reddit-enhanced typing with variable delays and typo simulation
    redditTypeChars: function (field, text, callback) {
      var self = this;
      var words = text.split(/(\s+)/); // Split keeping whitespace
      var wordIdx = 0;
      var charIdx = 0;
      var currentWord = '';

      function typeNextChar() {
        if (AutomationEngine.state !== 'running') { callback(); return; }
        if (wordIdx >= words.length) { callback(); return; }

        if (charIdx === 0) {
          currentWord = words[wordIdx];
        }

        if (charIdx >= currentWord.length) {
          wordIdx++;
          charIdx = 0;
          bgTimeout(typeNextChar, jitter(randomBetween(30, 80), 0.2));
          return;
        }

        var char = currentWord[charIdx];
        // Variable delay: 50-180ms per character
        var delay = jitter(randomBetween(50, 180), 0.3);
        // Mid-word pause: ~15% chance
        if (Math.random() < 0.15 && charIdx > 0 && charIdx < currentWord.length - 1) {
          delay += jitter(randomBetween(200, 500), 0.2);
        }

        // Typo simulation: ~3% per word, only on non-first character
        if (charIdx > 0 && charIdx < currentWord.length - 1 && Math.random() < 0.03) {
          var wrongChar = String.fromCharCode(char.charCodeAt(0) + (Math.random() < 0.5 ? 1 : -1));
          // Type wrong char
          field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: wrongChar }));
          if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
            var start = field.selectionStart;
            var val = field.value;
            field.value = val.substring(0, start) + wrongChar + val.substring(start);
            field.selectionStart = field.selectionEnd = start + 1;
          } else {
            document.execCommand('insertText', false, wrongChar);
          }
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: wrongChar }));
          // Pause, then backspace and type correct char
          bgTimeout(function () {
            field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Backspace' }));
            if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
              var pos = field.selectionStart - 1;
              field.value = field.value.substring(0, pos) + field.value.substring(pos + 1);
              field.selectionStart = field.selectionEnd = pos;
            } else {
              document.execCommand('delete');
            }
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Backspace' }));
            // Now type correct char after pause
            bgTimeout(function () {
              field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: char }));
              if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
                var s = field.selectionStart;
                var v = field.value;
                field.value = v.substring(0, s) + char + v.substring(s);
                field.selectionStart = field.selectionEnd = s + 1;
              } else {
                document.execCommand('insertText', false, char);
              }
              field.dispatchEvent(new Event('input', { bubbles: true }));
              field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: char }));
              charIdx++;
              bgTimeout(typeNextChar, delay);
            }, jitter(randomBetween(200, 400), 0.2));
          }, jitter(randomBetween(200, 400), 0.2));
          return;
        }

        // Normal typing
        field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: char }));
        if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
          var s = field.selectionStart;
          var v = field.value;
          field.value = v.substring(0, s) + char + v.substring(s);
          field.selectionStart = field.selectionEnd = s + 1;
        } else {
          document.execCommand('insertText', false, char);
        }
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: char }));
        charIdx++;

        // Sentence-end pause
        if (char === '.' || char === '!' || char === '?') {
          delay += jitter(randomBetween(400, 800), 0.2);
        }

        bgTimeout(typeNextChar, delay);
      }

      typeNextChar();
    },

    // Reddit-enhanced click with jitter
    redditClick: function (el, callback) {
      var rect = el.getBoundingClientRect();
      var cx = rect.left + rect.width * (0.3 + Math.random() * 0.4) + randomBetween(-3, 3);
      var cy = rect.top + rect.height * (0.3 + Math.random() * 0.4) + randomBetween(-3, 3);

      // Dispatch mouseover + mousemove first
      document.dispatchEvent(new MouseEvent('mouseover', { clientX: cx, clientY: cy, bubbles: true }));
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: cx, clientY: cy, bubbles: true }));
      bgTimeout(function () {
        el.dispatchEvent(new MouseEvent('mousedown', { clientX: cx, clientY: cy, bubbles: true }));
        bgTimeout(function () {
          el.dispatchEvent(new MouseEvent('mouseup', { clientX: cx, clientY: cy, bubbles: true }));
          el.dispatchEvent(new MouseEvent('click', { clientX: cx, clientY: cy, bubbles: true }));
          if (callback) bgTimeout(callback, jitter(randomBetween(100, 300), 0.2));
        }, jitter(randomBetween(40, 100), 0.2)); // mousedown-mouseup delay
      }, jitter(randomBetween(50, 150), 0.2));
    },

    // Deduplication check against recent comment openings
    isDuplicateOpening: function (commentText) {
      if (!commentText) return false;
      var firstWords = commentText.trim().split(/\s+/).slice(0, 5).join(' ').toLowerCase();
      for (var i = 0; i < this.recentOpenings.length; i++) {
        if (this.recentOpenings[i] === firstWords) return true;
      }
      return false;
    },

    recordOpening: function (commentText) {
      if (!commentText) return;
      var firstWords = commentText.trim().split(/\s+/).slice(0, 5).join(' ').toLowerCase();
      this.recentOpenings.push(firstWords);
      if (this.recentOpenings.length > 10) this.recentOpenings.shift();
    },

    // Enhanced processPost for Reddit
    processRedditPost: function (postEl, reason) {
      var self = this;
      if (AutomationEngine.state !== 'running') return;
      var postId = AutomationEngine.getPostFingerprint(postEl);
      AutomationEngine.processedPosts.add(postId);
      AutomationEngine.stats.postsScanned++;
      AutomationEngine.addLog(reason || 'Processing Reddit post');

      // Extract subreddit and check targeting
      var subreddit = self.extractSubreddit(postEl);
      if (!self.isSubredditTarget(subreddit)) {
        AutomationEngine.stats.postsSkipped++;
        AutomationEngine.addLog('Skipped: subreddit r/' + (subreddit || 'unknown') + ' not targeted');
        AutomationEngine.scheduleNextCycle(jitter(3000, 0.3));
        return;
      }
      // Check subreddit cooldown
      if (!self.checkSubredditCooldown(subreddit)) {
        AutomationEngine.stats.postsSkipped++;
        AutomationEngine.addLog('Skipped: r/' + subreddit + ' cooldown');
        AutomationEngine.scheduleNextCycle(jitter(5000, 0.3));
        return;
      }
      // Check global rate limit
      if (!self.checkRateLimit()) {
        AutomationEngine.addLog('Rate limit reached: ' + self.config.maxCommentsPerHour + '/hr');
        // Wait until oldest timestamp expires
        var waitMs = self.commentTimestamps.length > 0 ? 3600000 - (Date.now() - self.commentTimestamps[0].timestamp) + 5000 : 60000;
        AutomationEngine.scheduleNextCycle(Math.max(waitMs, 60000));
        return;
      }
      // Check subreddit rules for bot restrictions
      self.checkSubredditRules(subreddit, function (allowed) {
        if (!allowed) {
          AutomationEngine.stats.postsSkipped++;
          AutomationEngine.scheduleNextCycle(jitter(5000, 0.3));
          return;
        }

        // Scroll to post and process
        AutomationEngine.scrollToPost(postEl, function () {
          if (AutomationEngine.state !== 'running') return;
          var readDelay = jitter(randomBetween(5000, 15000), 0.15);
          AutomationEngine.updateCountdown(readDelay, 'Reading...');
          bgTimeout(function () {
            if (AutomationEngine.state !== 'running') return;
            if (!postEl.isConnected) { AutomationEngine.addLog('Post removed from DOM'); AutomationEngine.scheduleNextCycle(jitter(3000, 0.3)); return; }
            var context = AutomationEngine.extractPostContext(postEl);
            // Add subreddit info to context
            context.subreddit = subreddit;

            // Determine business mention mode
            var mentionMode = null;
            if (self.shouldMentionBusiness(context)) {
              mentionMode = { active: true, businessName: self.config.businessName, businessDescription: self.config.businessDescription };
            }

            // Generate comment with reddit_auto_comment task
            var settings = savedSettings || {};
            var ps = (settings.platformSettings && settings.platformSettings.reddit) || {};
            var autoInstructionPresets = ps.instructionPresets || [];
            var autoCustomInstructions = ps.customInstructions || '';

            chrome.runtime.sendMessage({
              type: 'generate', data: {
                platform: 'reddit',
                task: 'reddit_auto_comment',
                tone: ps.tone || 'casual',
                context: context,
                personality: 'You are a real Reddit user. You are helpful, genuine, and community-aware. You match the subreddit culture. You write in natural conversational English like you are chatting with a peer. You never sound like marketing, a bot, or AI. You avoid corporate language entirely.',
                contextInfo: '',
                mentionPages: [],
                instructionPresets: autoInstructionPresets,
                customInstructions: autoCustomInstructions,
                mentionMode: mentionMode
              }
            }, function (response) {
              if (chrome.runtime.lastError) { console.log('[SAIC-Reddit] Error:', chrome.runtime.lastError.message); AutomationEngine.scheduleNextCycle(jitter(5000, 0.3)); return; }
              var text = (response && response.text) ? response.text.trim() : '';
              if (!text || text === 'SKIP') {
                AutomationEngine.stats.postsSkipped++;
                AutomationEngine.addLog(text === 'SKIP' ? 'Skipped: not relevant or controversial' : 'Skipped: no response');
                AutomationEngine.scheduleNextCycle(jitter(5000, 0.3));
                return;
              }
              // Dedup check
              if (self.isDuplicateOpening(text)) {
                AutomationEngine.addLog('Skipped: duplicate opening, retrying...');
                AutomationEngine.scheduleNextCycle(jitter(5000, 0.3));
                return;
              }
              // Record opening for dedup
              self.recordOpening(text);
              // Submit the comment using Reddit-enhanced methods
              if (self.config.autoSubmit) {
                self.submitRedditComment(postEl, text, subreddit, function (success) {
                  self.afterRedditComment(success, text, postEl, subreddit);
                });
              } else {
                AutomationEngine.showReviewOverlay(postEl, text, function (approved) {
                  if (approved) self.afterRedditComment(true, text, postEl, subreddit);
                  else { AutomationEngine.addLog('Skipped by user'); AutomationEngine.scheduleNextCycle(jitter(5000, 0.3)); }
                });
              }
            });
          }, readDelay);
        });
      });
    },

    // Submit comment using Reddit-enhanced behavioral biometrics
    submitRedditComment: function (postEl, text, subreddit, callback) {
      var self = this;
      if (AutomationEngine.state !== 'running') { callback(false); return; }
      AutomationEngine.clickCommentButton(postEl, function (replyField) {
        if (!replyField) { console.log('[SAIC-Reddit] No reply field'); callback(false); return; }
        // Use Reddit-enhanced typing
        self.redditTypeChars(replyField, text, function () {
          if (AutomationEngine.state !== 'running') { callback(false); return; }
          bgTimeout(function () {
            // Use Reddit-enhanced submit
            var selector = platformConfig.submitButtonSelector;
            if (!selector) { callback(false); return; }
            var container = replyField.closest('[role="dialog"]') || replyField.closest('form') || replyField.closest('.Comment, .thing, [data-testid="post-container"]') || postEl;
            var btn = container.querySelector(selector);
            if (!btn) btn = postEl.querySelector(selector);
            if (!btn) {
              var allBtns = container.querySelectorAll('button');
              for (var i = 0; i < allBtns.length; i++) {
                var txt = (allBtns[i].textContent || '').toLowerCase().trim();
                if (txt === 'post' || txt === 'reply' || txt === 'comment' || txt === 'submit' || txt === 'send') { btn = allBtns[i]; break; }
              }
            }
            if (!btn) { console.log('[SAIC-Reddit] No submit button'); callback(false); return; }
            var rect = btn.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) { console.log('[SAIC-Reddit] Submit not visible'); callback(false); return; }
            humanMouseMove(btn, function () {
              self.redditClick(btn, function () {
                console.log('[SAIC-Reddit] Submitted');
                callback(true);
              });
            });
          }, jitter(randomBetween(800, 2000), 0.2));
        });
      });
    },

    // After comment tracking
    afterRedditComment: function (success, text, postEl, subreddit) {
      var self = this;
      if (success) {
        AutomationEngine.stats.commentsMade++;
        self.totalComments++;
        self.commentTimestamps.push({ timestamp: Date.now(), subreddit: subreddit });
        // Track business mention
        if (self.config.businessName && text.toLowerCase().indexOf(self.config.businessName.toLowerCase()) !== -1) {
          self.mentionCount++;
        }
        AutomationEngine.addLog('Commented in r/' + subreddit + ': "' + (text || '').substring(0, 50) + '..."');
      } else {
        AutomationEngine.addLog('Failed to submit');
      }
      if (postEl) AutomationEngine.recordComment(postEl, text, success);
      AutomationEngine.updateUI();
      // Schedule next cycle with Reddit-specific delay
      var delay = self.getRedditDelay();
      AutomationEngine.scheduleNextCycle(delay);
    }
  };
```

- [ ] **Step 2: Integrate RedditAutoEngine into AutomationEngine.runCycle**

In `extension/content.js`, the `AutomationEngine.runCycle()` method at line 1221 processes posts. After finding candidates and before `processBestPost`, we need to add a Reddit-specific branch.

In the `processBestPost` method (line 1258), after selecting the `bestPost` and before calling `self.processPost(bestPost, bestReason)` (line 1281), add the Reddit delegation:

```javascript
      // Delegate to RedditAutoEngine for Reddit-specific processing
      if (platformName === 'reddit' && RedditAutoEngine.shouldActivate()) {
        RedditAutoEngine.loadConfig();
        RedditAutoEngine.processRedditPost(bestPost, bestReason);
        return;
      }
```

- [ ] **Step 3: Initialize RedditAutoEngine config on automation start**

In `AutomationEngine.start()` method (line 1166), after `this.loadConfig()` (line 1174), add:

```javascript
      if (platformName === 'reddit') RedditAutoEngine.loadConfig();
```

- [ ] **Step 4: Commit**

```bash
git add extension/content.js
git commit -m "feat: add RedditAutoEngine with behavioral biometrics, subreddit targeting, and safety checks"
```

---

### Task 6: Integrate mentionMode in background.js generate handler

**Files:**
- Modify: `extension/background.js` — the `generate` message handler where `buildPrompt` is called

- [ ] **Step 1: Pass mentionMode through the generate handler**

Find the `chrome.runtime.onMessage.addListener` handler for `type: 'generate'`. It calls `buildPrompt(...)` with data fields. Ensure the last argument passed is `data.mentionMode || null`.

The current call should look something like:
```javascript
var promptData = buildPrompt(data.platform, data.task, data.tone, data.context, data.personality, data.contextInfo, data.mentionPages, data.instructionPresets, data.customInstructions, data.mentionMode);
```

If the current call has fewer arguments, add `data.mentionMode` as the 10th argument to match the updated signature from Task 2.

- [ ] **Step 2: Commit**

```bash
git add extension/background.js
git commit -m "feat: pass mentionMode through generate handler for Reddit business mentions"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Reddit-specific prompt persona (Task 2)
- [x] Business mention injection with budget tracking (Task 2, Task 5)
- [x] Behavioral biometrics: typing with variable delays, typo sim (Task 5)
- [x] Behavioral biometrics: mouse movement (existing humanMouseMove, enhanced redditClick in Task 5)
- [x] Behavioral biometrics: click jitter (Task 5)
- [x] Timing randomization with coffee breaks (Task 5)
- [x] Subreddit whitelist + AI auto-detect (Task 5)
- [x] Subreddit blacklist (Task 5)
- [x] Bot-restriction detection (Task 5)
- [x] Post safety: skip controversial (Task 2 prompt)
- [x] Per-subreddit rate limiting (Task 5)
- [x] Global rate limiting (Task 5)
- [x] Comment deduplication (Task 5)
- [x] Settings migration (Task 1)
- [x] Popup UI (Task 3)
- [x] Popup load/save wiring (Task 4)
- [x] Background tab operation via bgTimeout (Task 5 uses bgTimeout throughout)
