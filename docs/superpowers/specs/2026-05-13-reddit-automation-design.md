# Reddit Automation Engine Design

## Overview

A Reddit-specific automation layer (`RedditAutoEngine`) within the existing Chrome extension that produces natural, helpful, human-like comments in business-relevant subreddits. Anti-detection is a first-class concern. Business mentions are rare and subtle, positioned as personal experience.

## Architecture

`RedditAutoEngine` extends the existing `AutomationEngine` pattern. When the platform is Reddit, the Reddit-specific engine takes over the automation cycle with enhanced safety, targeting, and comment generation.

### Files Affected

- **content.js** — Add `RedditAutoEngine` object with Reddit-specific automation logic, behavioral biometrics, and safety checks
- **background.js** — Add `reddit_auto_comment` task instruction and Reddit-specific prompt building with conditional business mention injection
- **popup.html** — Expand Reddit panel with subreddit targeting, business identity, and safety settings
- **popup.js** — Load/save Reddit-specific settings (targetSubreddits, blacklistSubreddits, businessName, etc.)

### Data Flow

```
1. AutomationEngine.init() detects platformName === 'reddit'
   → delegates to RedditAutoEngine.init()

2. RedditAutoEngine.runCycle()
   → finds posts via DOM selectors
   → extracts subreddit name from each post
   → checks whitelist, then blacklist, then AI auto-detect if enabled
   → checks safety: rate limit per subreddit, blocked subs, post age, thread history

3. RedditAutoEngine.processPost()
   → extracts context (post text, subreddit, comments, flair)
   → checks mention budget: (recentMentions / recentTotal) < mentionFrequency?
   → sends to background with task: 'reddit_auto_comment'
   → if mention opportunity detected + under budget, includes business context

4. background.js buildPrompt()
   → detects reddit_auto_comment task
   → uses Reddit-specific prompt persona
   → conditionally injects business mention instruction
   → AI generates comment

5. RedditAutoEngine receives comment
   → deduplication check against recent openings
   → records opening style for future variance
   → submits via enhanced behavioral biometrics (Bezier mouse, variable typing)
   → schedules next cycle via bgTimeout with heavy jitter
```

## Component 1: Reddit-Specific Comment Generation

### Prompt Persona (background.js)

New task `reddit_auto_comment`:

```
STEP 1 — CLASSIFY: Read the post. Is it about SaaS, e-commerce, startups, business, marketing, product development, entrepreneurship, tech tools, or business problems/solutions? If clearly personal (memes, hobbies, gossip, politics, personal life), respond with exactly SKIP.

STEP 2 — SAFETY CHECK: Is this post controversial, heated debate, political, or emotionally charged? If yes, respond with exactly SKIP.

STEP 3 — COMMENT: Write a helpful, genuine comment.
- 3-4 lines normally, 6-7 lines when naturally sharing experience
- Sound like a real Redditor who genuinely wants to help
- Match the subreddit's vibe (technical in r/SaaS, casual in r/startups)
- Offer specific advice, share relevant experience, or ask a thoughtful follow-up
- NO marketing language, NO pitches, NO call-to-action
- Use simple conversational English, like chatting with a peer
- Start naturally — react to what they said, don't say "Great post!"
```

### Business Mention Injection

Conditionally added to system prompt when:
1. Post is classified as a mention opportunity (someone asking for recommendations, frustrated with a solution, asking how to do something)
2. Mention budget allows it (recent mentions / recent total < mentionFrequency setting)

```
BUSINESS MENTION MODE ACTIVE:
This post is asking for recommendations / expressing frustration with a solution / asking how to do something your business covers.
You may briefly mention your experience with [BUSINESS_NAME] as a personal anecdote — "I switched to [BUSINESS_NAME] a while back and it handles X pretty well" or "we use [BUSINESS_NAME] for this at our startup".
Keep it casual, like a side note in a helpful comment. The mention should be 1 line within a 6-7 line comment. The rest must be genuinely helpful advice.
Business: [BUSINESS_NAME] — [BUSINESS_DESCRIPTION]
```

### Deduplication Check

Before accepting a generated comment, compare its first 5 words against the last 10 comment openings. If it matches any, request a regeneration (max 2 retries).

## Component 2: Anti-Detection & Behavioral Biometrics

### Why Chrome Extensions Are Already Safe

Running inside a real Chrome browser means:
- `navigator.webdriver` is NOT set to true (only Selenium/Puppeteer set this)
- No headless browser leaks (real GPU, real plugins, real canvas fingerprint)
- TLS/SSL fingerprint is normal Chrome (not a script's TLS handshake)
- IP is user's residential ISP (not a datacenter)

### What We Harden

**Typing — `humanType(text, field, callback)`**
- Variable keystroke delays: 50-180ms per character (weighted random, not uniform)
- Occasional mid-word pauses: 200-500ms (triggered ~15% of the time)
- Rare typo simulation: ~3% chance per word — type wrong char, pause 200-400ms, backspace, type correct char
- Paragraph breaks: 400-800ms pause at sentence endings

**Mouse Movement — `humanMouseMove(targetEl, callback)`**
- Bezier curve path from current cursor position to target element
- 2-3 control points for natural curvature
- Slight overshoot: 5-15px past target, then correct back
- Movement duration: 300-800ms depending on distance
- Speed variation: faster in middle, slower at start and end

**Click — `humanClick(el, callback)`**
- Position jitter: target point ±3px from element center
- Micro-delay between mousedown and mouseup: 40-100ms
- Dispatch real MouseEvent sequences (mouseover → mousemove → mousedown → mouseup → click)

**Scrolling**
- Smooth scroll with slight speed variation
- Occasional scroll-up-then-back-down (5% chance, simulates re-reading)
- Scroll distance varies: never exactly viewport height

### Timing Randomization

More aggressive than other platforms:
- Base interval from user setting (e.g. 90s)
- Actual delay = base * random(0.7 - 1.6) + jitter(±20%)
- After every 3-5 comments: "coffee break" pause of 3-8 minutes
- Reading delay before commenting: 5-15 seconds (simulates reading the post)
- All timing uses `bgTimeout` (Web Worker) — works in background tabs

## Component 3: Safety System

### Subreddit Safety

- **Bot-restriction detection**: On first encounter with a subreddit, check sidebar/rules text for keywords: `no bots`, `no automated`, `no AI`, `no self-promo`, `human only`, `manual posts only`
- **Cache**: Maintain `blockedSubreddits` Set — once a sub is flagged, skip all posts from it for the session
- **User blacklist**: Subreddits manually blacklisted in settings are always skipped

### Post Safety

- AI safety pass (Step 2 in prompt): skip controversial, heated, political, emotionally charged posts
- Skip posts less than `skipNewPostsMinutes` old (default 60 min) — too visible to moderators
- Skip stickied / moderator / announcement posts
- Skip posts with "meta" or "announcement" flair

### Rate Limiting

- **Global**: User-configurable max comments per hour (slider 1-10, default 3), hard cap at 10
- **Per-subreddit**: Max 2 comments per subreddit per hour, regardless of global limit
- **Subreddit rotation**: Never comment in the same subreddit consecutively. If only 1 target subreddit, enforce 5-minute minimum gap between comments there
- **Session cap**: Existing stopLimit setting applies

### Comment Pattern Variation

- Rolling buffer of last 10 comment first-lines — all must be unique
- Comment length variance: weighted random between 3-7 lines
- Style rotation: advice-giving, experience-sharing, question-asking, resource-pointing
- Deduplication: if generated comment's first 5 words match any of last 10, regenerate (max 2 retries)

## Component 4: Subreddit Targeting

### Hybrid Approach

1. **Whitelist (primary)**: User lists target subreddits (e.g. SaaS, startups, ecommerce). Engine scans these first.
2. **AI genre detection (fallback)**: When `autoDetectGenre` is enabled, engine also considers posts from other subreddits. AI classifies whether the post is about SaaS, e-commerce, startups, or business. If yes and subreddit is not blacklisted, it becomes a candidate.

### Targeting Flow

```
For each candidate post:
  1. Extract subreddit name from post DOM
  2. Is it in blacklist? → Skip
  3. Is it in blockedSubreddits cache? → Skip
  4. Is it in target whitelist? → Candidate, proceed to safety checks
  5. Is autoDetectGenre enabled?
     Yes → AI classifies genre → if business-relevant, proceed to safety checks
     No → Skip
  6. Safety checks pass? → Process post
```

## Component 5: Popup Settings UI

New sections added to the Reddit panel in popup.html:

### Subreddit Targeting
- **Target subreddits**: textarea, one per line (e.g. `SaaS`, `startups`, `ecommerce`)
- **Blacklist subreddits**: textarea, one per line (subreddits to never comment in)
- **Auto-detect genre**: toggle, ON = AI scans beyond whitelist for business-relevant posts

### Business Identity
- **Business name**: text input
- **Business description**: textarea (2-3 sentences)
- **Mention frequency**: slider 0-100% (default 15%)

### Safety Settings
- **Max comments per hour**: slider 1-10 (default 3)
- **Skip posts newer than**: number input in minutes (default 60)
- **Auto-skip bot-restricted subreddits**: toggle (default ON)

Existing Reddit settings (tone, context, instruction presets, custom instructions, interval, stop limit, engagement thresholds, mention pages) remain as the base layer.

## Component 6: Settings Data Structure

New fields on `platformSettings.reddit`:

```javascript
{
  // Existing fields unchanged
  tone: 'casual',
  activeContext: '',
  instructionPresets: [],
  customInstructions: '',
  autoSubmit: true,
  interval: 90,
  stopLimit: 0,
  contentFilter: 'business',
  engagementThresholds: { minUpvotes: 50, minComments: 10 },
  mentionPages: [],

  // New subreddit targeting
  targetSubreddits: [],          // ['SaaS', 'startups', 'ecommerce']
  blacklistSubreddits: [],       // ['PoliticalDiscussion']
  autoDetectGenre: true,

  // Business identity
  businessName: '',
  businessDescription: '',
  mentionFrequency: 15,          // 0-100 percentage

  // Safety
  maxCommentsPerHour: 3,         // 1-10
  skipNewPostsMinutes: 60,
  skipBotRestrictedSubs: true
}
```

### Migration

`migrateSettings()` in content.js adds default values for all new Reddit fields when missing from existing saved settings. Same pattern as instruction presets migration.

## Component 7: Background Tab Operation

All timing in `RedditAutoEngine` uses the existing `bgTimeout`/`bgClear` Web Worker system. This ensures:
- Timers fire accurately even when the Reddit tab is inactive/backgrounded
- No reliance on `setTimeout` (which browsers throttle in background tabs)
- DOM operations (scrolling, clicking, typing) still execute in background tabs since the content script remains alive

## Summary of New Code

| File | What's Added |
|------|-------------|
| content.js | `RedditAutoEngine` object (~300 lines): init, runCycle, processPost, safety checks, behavioral biometrics (humanMouseMove, humanType, humanClick), subreddit targeting, rate limiting, deduplication |
| background.js | `reddit_auto_comment` task instruction, conditional business mention injection in buildPrompt, Reddit-specific personality override |
| popup.html | 3 new sections in Reddit panel: Subreddit Targeting, Business Identity, Safety Settings |
| popup.js | Load/save new Reddit settings fields, mention frequency slider handler |
