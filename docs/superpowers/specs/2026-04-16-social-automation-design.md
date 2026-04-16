# Social Media Auto-Interaction Design

**Date:** 2026-04-16
**Status:** Draft
**Scope:** Integrate page-agent core into Social AI Copilot for ICP-targeted social media interactions

---

## 1. Goal

Add ICP-targeted automation to the Social AI Copilot Chrome extension: auto-comment, auto-post, auto-like, auto-repost, and auto-follow across LinkedIn, Facebook, X/Twitter, and Reddit. The user defines an **Ideal Customer Profile (ICP)**, and the system uses **Gemini semantic embeddings** to match posts against the ICP before interacting. Only posts that meet a similarity threshold receive interactions.

---

## 2. Architecture

### 2.1 New Modules

Five new modules are added under `core/` and `utils/`:

```
core/
├── ...existing files...
├── automationEngine.js      # ReAct loop orchestrator with ICP matching gate
├── domExtractor.js          # DOM → indexed text conversion (from page-agent)
├── pageController.js        # DOM action executor (click, type, scroll)
├── icpMatcher.js            # ICP → embedding → cosine similarity matching

utils/
├── ...existing files...
├── automationSelectors.js   # Platform-specific selectors for automation targets
├── embeddingStore.js        # IndexedDB storage for embeddings cache
```

### 2.2 Core Concept: ICP-Gated Interactions

Every interaction goes through a **match gate** before execution:

```
Post found on feed
  → Extract post text
  → Generate embedding via Gemini API
  → Check IndexedDB cache (skip API call if already embedded)
  → Cosine similarity: post_embedding vs icp_embedding
  → similarity >= threshold? → INTERACT (like/comment/follow/repost)
  → similarity < threshold?  → SKIP, scroll to next post
```

This ensures **zero random interactions** — every action is semantically justified.

### 2.3 How It Works (Full Flow)

1. **User defines ICP** via free-text description and/or structured form fields
2. **System embeds the ICP** using Gemini embedding API → stores in IndexedDB
3. **User configures automation**: interaction types, count, mode, threshold
4. `automationEngine` starts a ReAct loop:
   - **Observe:** `domExtractor` converts visible DOM to indexed text
   - **Filter:** Engine identifies posts in DOM, extracts text, runs through `icpMatcher`
   - **Reason:** Matched posts + interaction goal → AI provider returns tool calls
   - **Act:** `pageController` executes tool calls (click, type, scroll)
   - **Check:** Count completed? No more matches? Error?
5. In **review mode**, engine pauses before submission and shows match score + draft

### 2.4 Existing Code Reuse

| Existing Module | Automation Role |
|---|---|
| `core/aiProvider.js` | Routes LLM calls for reasoning and comment generation |
| `core/promptBuilder.js` | Builds system prompts with platform + ICP context |
| `core/contextExtractor.js` | Extracts post content for matching and comment generation |
| `utils/platform.js` | Platform detection and field selectors |
| `utils/dom.js` | DOM helpers used by pageController |
| `extension/background.js` | Proxies AI + Gemini embedding calls |
| `extension/content.js` | Hosts automationEngine, adds automation UI |

---

## 3. Module Details

### 3.1 icpMatcher.js — Semantic ICP Matching

The core intelligence layer that decides whether a post is worth interacting with.

**ICP Definition (dual input):**

Users define their ICP two ways — both are combined into the embedding:

```
Free-text ICP (primary):
  "SaaS founders in Series A-B who post about AI automation,
   productivity tools, and no-code platforms. Target CTOs and
   VP Engineering at tech companies with 10-200 employees.
   Interested in: MLOps, workflow optimization, developer tools."

Structured fields (optional refinement):
  - Industry: SaaS, AI, Fintech
  - Target Roles: Founder, CTO, VP Engineering
  - Company Size: 10-200
  - Key Topics: AI, automation, no-code
  - Content Type: thought leadership, product launches, tutorials
  - Exclude: job postings, memes, personal life posts
```

**Matching flow:**

```
1. On session start:
   - Combine free-text + structured fields into a single ICP document
   - Call Gemini embedding API → get icp_embedding vector (768-dim)
   - Store { icpId, text, embedding, created } in IndexedDB

2. For each candidate post:
   - Extract post text from DOM
   - Hash post text → check IndexedDB cache
   - If cache miss: call Gemini embedding API → store { postHash, embedding }
   - Compute cosine_similarity(post_embedding, icp_embedding)
   - Return { score, matched, postText }
```

**Cosine similarity:**

```javascript
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

**Threshold defaults (configurable):**

| Interaction | Default Threshold | Rationale |
|---|---|---|
| Like | 0.60 | Lower bar — liking is low-commitment |
| Comment | 0.72 | Higher bar — comments are visible, must be relevant |
| Repost | 0.75 | Higher bar — resharing to your network |
| Follow | 0.65 | Medium — following is reversible |

**Threshold tuning:** Users can adjust per interaction type via sliders (0.0 - 1.0).

### 3.2 embeddingStore.js — IndexedDB Embedding Cache

Persistent client-side storage for all embeddings to minimize API calls.

**Schema:**

```
Database: social-agent-embeddings
Version: 1

Object Stores:

1. icp_profiles
   - id: string (auto-generated UUID)
   - name: string (user-given label)
   - text: string (combined free-text + structured ICP)
   - embedding: Float32Array (768-dim Gemini vector)
   - createdAt: number (timestamp)
   - lastUsed: number (timestamp)

2. post_embeddings
   - postHash: string (SHA-256 of post text)
   - platform: string (linkedin/facebook/x/reddit)
   - embedding: Float32Array (768-dim)
   - postText: string (first 200 chars for debug)
   - createdAt: number (timestamp)

3. match_history
   - id: string (UUID)
   - icpId: string (foreign key to icp_profiles)
   - postHash: string
   - similarity: number (0-1)
   - matched: boolean
   - interactionType: string
   - action: string ('interacted' | 'skipped')
   - timestamp: number
```

**Cache policy:**
- ICP profiles: persistent until user deletes
- Post embeddings: auto-expire after 30 days
- Match history: auto-expire after 90 days
- Max storage: 50MB (cleaned by oldest when exceeded)

**Gemini embedding API integration (via background.js):**

```
POST https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent
Headers: x-goog-api-key: {user's Gemini API key}
Body: { model: "models/text-embedding-004", content: { parts: [{ text }] } }

Response: { embedding: { values: [0.012, -0.034, ...] } }
```

User adds their Gemini API key in extension settings (alongside existing OpenAI/GLM keys).

### 3.3 domExtractor.js (from page-agent `page-controller`)

Converts live DOM into a flat, indexed text representation that the LLM can read.

**Responsibilities:**
- Walk the DOM tree, filtering to interactive elements (buttons, inputs, links, contenteditable)
- Assign numeric indexes to each interactive element
- Extract post text content for ICP matching
- Output text format:

```
Current Page: [LinkedIn Feed](https://linkedin.com/feed)
Page info: 1920x1080px viewport, 1920x4000px total page size

Interactive elements:
[0]<button aria-label="Like">Like</button>
[1]<button aria-label="Comment">Comment</button>
    *[2]<div contenteditable="true" placeholder="Add a comment..."></div>
[3]<button aria-label="Reply">Reply</button>
[4]<article>Great article about AI trends in 2026...</article>
[5]<button aria-label="Like">Like</button>
```

- `*` marks newly appeared elements (after scroll or action)
- Only processes visible viewport elements by default
- Preserves semantic landmarks (nav, main, article)
- Returns both: (1) indexed DOM text for LLM, (2) extracted post texts for ICP matching

**Adapted from:** `packages/page-controller/src/dom-extractor/` — simplified for social media DOMs

### 3.4 pageController.js (from page-agent `page-controller`)

Executes DOM actions requested by the LLM.

**Supported actions (tools):**

| Tool | Description |
|---|---|
| `click_element_by_index` | Click element by its DOM index |
| `input_text` | Type text into input/contenteditable fields |
| `scroll` | Scroll vertically (page or container) |
| `wait` | Wait for page load / element appearance |
| `done` | Signal task completion with result |

**Each action:**
- Recovers element by index from stored selector map
- Scrolls element into view if needed
- Simulates real pointer events (mousedown → mouseup → click)
- Handles contenteditable with input event dispatch
- Returns success/failure with page state update

**Adapted from:** `packages/page-controller/src/executor/`

### 3.5 automationEngine.js (from page-agent `core`)

The ReAct loop orchestrator — runs the ICP-gated automation.

**Class: `AutomationEngine`**

```
Configuration:
  - platform: 'linkedin' | 'facebook' | 'x' | 'reddit'
  - interactionType: 'comment' | 'like' | 'follow' | 'repost'
  - icpProfileId: string (references stored ICP in IndexedDB)
  - maxCount: number (1-50, default 10)
  - mode: 'auto' | 'review'
  - interval: number (ms between actions, min 120s)
  - tone: 'professional' | 'casual' | 'witty' | 'direct'
  - thresholds: { like: 0.60, comment: 0.72, repost: 0.75, follow: 0.65 }

State:
  - status: 'idle' | 'running' | 'paused' | 'completed' | 'error'
  - completedCount: number
  - skippedCount: number (posts that didn't match ICP)
  - currentStep: number
  - maxSteps: number (default 150)
  - history: Array of { role, content, toolCalls }

Events:
  - 'statuschange' — status transitions
  - 'progress' — { completed, skipped, total, currentMatch }
  - 'action' — before each action (for review mode, includes similarity score)
  - 'match' — { postText, similarity, matched } for each post evaluated
  - 'log' — debug/audit trail

Methods:
  - start(config) → begins automation
  - pause() → pauses loop
  - resume() → resumes loop
  - approveAction(actionId) → approves pending action in review mode
  - rejectAction(actionId) → rejects, engine adapts
  - stop() → terminates automation
```

**ICP-Gated ReAct Loop:**

```
1. Load ICP embedding from IndexedDB
2. while (completedCount < maxCount && step < maxSteps && status === 'running'):
   a. domExtractor.extract() → { indexedDomText, postTexts }
   b. For each candidate post in postTexts:
      i.   icpMatcher.match(postText, icpEmbedding, threshold)
      ii.  If similarity < threshold → skip, emit 'match' event (not matched)
      iii. If similarity >= threshold → proceed:
           - Emit 'match' event (matched, similarity score)
           - Build prompt: system + ICP context + matched post + interaction goal
           - Send to AI provider via aiProvider.dispatch()
           - Parse response for tool calls (click like, type comment, etc.)
           - If mode === 'review':
               emit 'action' with { similarity, postText, draftContent }
               wait for user approve/reject/edit
           - pageController.execute(toolCall)
           - completedCount++
           - Log to match_history in IndexedDB
   c. If no matches found in viewport → scroll down, re-extract DOM
   d. Wait interval ms (+ random jitter ±30s)
   e. step++
3. emit 'statuschange' (completed/error)
```

**System prompt includes:**
- Platform context and available tools
- The ICP description (full text) for the LLM to reference when composing comments
- Instruction: "You are interacting with posts that have been semantically matched to this ICP. Compose comments that demonstrate genuine understanding of the topic. Never repeat the same comment pattern. Vary length, tone, and specific points addressed."

### 3.6 automationSelectors.js

Platform-specific CSS selectors for identifying posts and interaction elements:

```
PLATFORMS = {
  linkedin: {
    postContainer: '.feed-update-wrapper, .occludable-update',
    postText: '.break-words, .attributed-text-segment-list__content',
    commentBox: '.ql-editor[contenteditable="true"]',
    commentSubmit: 'button[type="submit"]',
    likeButton: 'button[aria-label*="Like"]',
    repostButton: 'button[aria-label*="Repost"]',
    followButton: 'button[aria-label*="Follow"]',
    authorInfo: '.update-components-actor__title, .update-components-actor__description',
  },
  facebook: {
    postContainer: '[data-pagelet="FeedUnit"]',
    postText: '[data-ad-preview="message"] p, [dir="auto"] span',
    commentBox: '[contenteditable="true"][aria-label*="Comment"]',
    likeButton: '[aria-label*="Like"]',
    shareButton: '[aria-label*="Share"]',
    followButton: '[aria-label*="Follow"]',
  },
  x: {
    postContainer: '[data-testid="tweet"]',
    postText: '[data-testid="tweetText"]',
    likeButton: '[data-testid="like"]',
    repostButton: '[data-testid="retweet"]',
    replyBox: '[data-testid="tweetTextarea_0"]',
    followButton: '[data-testid*="follow"]',
  },
  reddit: {
    postContainer: '[data-testid="post-container"], .thing.link',
    postText: '[data-testid="post-container"] h2, .expando .md',
    commentBox: '[contenteditable="true"][data-testid="comment"]',
    upvoteButton: '[aria-label="upvote"]',
    saveButton: '[data-testid="save-post"]',
  }
}
```

These selectors are included in the system prompt as hints for the LLM.

---

## 4. UI Integration

### 4.1 ICP Configuration Panel

A new "ICP Profiles" section in the extension settings:

**Free-text ICP input:**
```
┌─────────────────────────────────────────┐
│  Define Your ICP                        │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ SaaS founders in Series A-B     │    │
│  │ who post about AI automation,   │    │
│  │ productivity tools. CTOs and    │    │
│  │ VPs at tech companies 10-200    │    │
│  │ employees...                    │    │
│  └─────────────────────────────────┘    │
│                                         │
│  - OR refine with structured fields -   │
│                                         │
│  Industry:    [SaaS, AI, Fintech    ]   │
│  Roles:       [CTO, Founder, VP Eng ]   │
│  Company Size:[10-200              ]    │
│  Key Topics:  [AI, automation, no-code] │
│  Exclude:     [job posts, memes     ]   │
│                                         │
│  Profile Name: [My SaaS ICP        ]    │
│                                         │
│  [Save ICP Profile]                     │
│                                         │
│  Saved Profiles:                        │
│  ● My SaaS ICP (last used: 2h ago)     │
│  ○ Marketing Leaders                    │
│  ○ DevRel Targets                       │
└─────────────────────────────────────────┘
```

Users can save multiple ICP profiles and switch between them.

### 4.2 Automation Panel

New "Automation" tab in the floating popover:

```
┌─────────────────────────────────────┐
│  Automation                         │
│                                     │
│  ICP Profile: [My SaaS ICP ▾]      │
│                                     │
│  Interaction Type:                  │
│  ○ Like  ○ Comment  ○ Repost       │
│  ○ Follow  ☑ Multiple (select)     │
│                                     │
│  Count: [10]  Max: 50              │
│  Mode: [Auto ● | ○ Review]         │
│  Interval: [===●===] 180s          │
│  Tone: [Professional ▾]            │
│                                     │
│  Match Thresholds:                  │
│  Like:    [===●===] 0.60           │
│  Comment: [===●===] 0.72           │
│  Repost:  [===●===] 0.75           │
│  Follow:  [===●===] 0.65           │
│                                     │
│  [▶ Start Automation]              │
│  [⏸ Pause]  [⏹ Stop]              │
│                                     │
│  ─── Live Status ───                │
│  7/10 interactions completed        │
│  23 posts evaluated                 │
│  7 matched (30.4%)  16 skipped      │
│  Current: Commenting on AI post...  │
│  Match score: 0.84                  │
│                                     │
│  ─── Recent Actions ───             │
│  ✓ Commented (0.89) "Great..."     │
│  ✓ Liked (0.76) post by @cto_jane  │
│  ✗ Skipped (0.41) "Best pizza..."  │
│  ✓ Followed (0.71) @saas_founder   │
└─────────────────────────────────────┘
```

### 4.3 Review Mode Overlay

When in review mode, engine pauses for each matched post:

```
┌─────────────────────────────────────┐
│  Review Interaction                 │
│                                     │
│  Match Score: ████████░░ 0.84      │
│                                     │
│  Post by @jane_doe (CTO, Acme AI): │
│  "Just shipped our new ML pipeline  │
│   that reduced inference time by    │
│   40%. Here's what we learned..."   │
│                                     │
│  ICP Match: AI, MLOps, devtools ✓  │
│                                     │
│  Draft Comment:                     │
│  ┌─────────────────────────────┐    │
│  │ Impressive results! The 40% │    │
│  │ reduction must have required │    │
│  │ significant pipeline work... │    │
│  └─────────────────────────────┘    │
│                                     │
│  [✓ Approve] [✎ Edit] [→ Skip]    │
└─────────────────────────────────────┘
```

Shows match score, why it matched, and editable draft.

---

## 5. Safety Measures

1. **Minimum interval:** 120 seconds between actions (not configurable below this)
2. **Disclaimer:** User must acknowledge risks before first use
3. **Max count cap:** 50 interactions per session
4. **ICP gating:** No interaction without semantic match above threshold
5. **Anti-detection:** Random jitter on intervals (±30s), varied comment wording
6. **Content guard:** LLM instructed to never post identical comments, never engage with sponsored content
7. **Emergency stop:** Stop button immediately halts all automation
8. **Audit log:** Every match evaluation logged in IndexedDB match_history
9. **No credential automation:** Never automates login, password entry, or account settings
10. **Gemini key security:** Stored in chrome.storage.local, never exposed to page context

---

## 6. Data Flow

```
User defines ICP
  → icpMatcher.createProfile(freeText, structuredFields)
  → background.js → Gemini Embedding API → 768-dim vector
  → embeddingStore.saveIcpProfile({ text, embedding })
  → Returns icpProfileId

User starts automation
  → automationEngine.start({ icpProfileId, interactionType, count, mode, thresholds })
    → Load ICP embedding from IndexedDB
    → Loop:
      → domExtractor.extract(document)
        → Returns { indexedDomText, candidatePosts: [{ text, element }] }
      → For each candidate post:
        → embeddingStore.getPostEmbedding(hash)
          → Cache hit? → return cached vector
          → Cache miss? → background.js → Gemini Embedding API → cache result
        → cosineSimilarity(postEmbedding, icpEmbedding)
        → score < threshold? → skip, log to match_history
        → score >= threshold? → matched:
          → Build prompt: ICP + post + interaction goal
          → aiProvider.dispatch(prompt) [via background.js]
          → Parse tool calls from LLM response
          → [if review mode] → emit 'action' → user approves
          → pageController.execute(toolCall)
          → completedCount++
          → Log to match_history (interacted)
      → No matches in viewport? → pageController.scroll('down') → re-extract
      → Wait interval ± jitter
    → Loop ends
  → emit 'statuschange' (completed/error)
```

---

## 7. Error Handling

| Error | Behavior |
|---|---|
| Gemini API failure | Retry up to 3 times with backoff. If persistent, fall back to LLM-based relevance judgment (prompt the AI to score 1-10) |
| LLM API failure | Retry up to 3 times with backoff, then pause and notify user |
| Element not found | Re-extract DOM and retry once, then skip and continue |
| Rate limit detected | Pause automation, wait 5 minutes, resume |
| IndexedDB quota exceeded | Delete oldest post embeddings, retry |
| Page navigation | Detect URL change, re-extract DOM, continue |
| Max steps reached | Stop and report progress |
| User closes panel | Stop automation gracefully |

---

## 8. What We're NOT Building

- Login automation (security risk)
- DM/messaging automation (high spam risk)
- Scraping/data extraction (export post data)
- Cross-platform campaigns in one session (one platform at a time)
- Scheduling/future-timed automation (only real-time)
- Image/media upload automation
- Automatic ICP generation from user profile

---

## 9. New Settings Required

Added to extension settings (popup.html + storage.js):

| Setting | Type | Default |
|---|---|---|
| `geminiApiKey` | string | '' |
| `savedIcpProfiles` | array | [] |
| `automationDefaults.thresholds.like` | number | 0.60 |
| `automationDefaults.thresholds.comment` | number | 0.72 |
| `automationDefaults.thresholds.repost` | number | 0.75 |
| `automationDefaults.thresholds.follow` | number | 0.65 |
| `automationDefaults.interval` | number | 180000 |
| `automationDefaults.mode` | string | 'review' |
| `automationDisclaimerAccepted` | boolean | false |

---

## 10. Implementation Order

1. `utils/embeddingStore.js` — IndexedDB setup + CRUD for embeddings
2. `core/icpMatcher.js` — ICP embedding + cosine similarity matching
3. `core/domExtractor.js` — DOM text extraction (port from page-agent)
4. `core/pageController.js` — Action execution (port from page-agent)
5. `utils/automationSelectors.js` — Platform selectors
6. `core/automationEngine.js` — ICP-gated ReAct loop
7. Gemini API key setting in popup
8. ICP Profile UI (create/edit/select profiles)
9. Automation Panel UI in floating popover
10. Review Mode overlay
11. Safety measures, disclaimer, audit log
12. Background.js updates for Gemini embedding proxy
