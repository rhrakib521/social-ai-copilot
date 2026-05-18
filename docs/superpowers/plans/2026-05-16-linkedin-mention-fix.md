# LinkedIn Mention Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken LinkedIn @mention automation so autopilot comments include a real mention chip for the configured page.

**Architecture:** The AI generates a comment with the page name as a plain word. The `splitByMentions` parser identifies where that word appears. The rewritten `insertMention` function types `@` + page name character-by-character into LinkedIn's Quill editor to trigger its mention dropdown, then `selectMentionResult` polls for and clicks the first dropdown result. On failure, it gracefully falls back to plain text.

**Tech Stack:** Chrome Extension (content.js content script, background.js service worker), LinkedIn's Quill-based `ql-editor` contenteditable.

---

### Task 1: Rewrite `insertMention` for LinkedIn's contenteditable editor

**Files:**
- Modify: `extension/content.js:2015-2025`

The current `insertMention` just calls `typeChars` with `@PageName` and then calls `selectMentionResult`. For LinkedIn's `ql-editor` contenteditable, we need a more targeted approach: type `@` separately, then type the page name characters, giving LinkedIn's observer time to register each keystroke for its search query.

- [ ] **Step 1: Replace the `insertMention` function**

Replace the function at line 2015 with:

```javascript
    insertMention: function (field, pageName, callback) {
      var self = this;
      // Plain text fields (textarea/input) — just type the name, no dropdown
      if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
        self.typeChars(field, pageName, callback);
        return;
      }
      // contenteditable (LinkedIn ql-editor, Facebook, etc.)
      // Step 1: Type @ character to trigger mention observer
      field.focus();
      document.execCommand('insertText', false, '@');
      field.dispatchEvent(new Event('input', { bubbles: true }));

      // Step 2: After a short delay, type the page name characters
      bgTimeout(function () {
        if (self.state !== 'running') { callback(); return; }
        self.typeChars(field, pageName, function () {
          // Step 3: Try to select from dropdown
          self.selectMentionResult(field, pageName, callback);
        });
      }, 400);
    },
```

- [ ] **Step 2: Verify syntax by searching for the old function signature**

Run: `grep -n "insertMention" "D:/Coding/Social Media Agent/extension/content.js"`

Expected: Only one definition at the new location. The old two-line `insertMention` is gone.

- [ ] **Step 3: Commit**

```bash
git add extension/content.js
git commit -m "fix: rewrite insertMention to type @ then page name separately for LinkedIn"
```

---

### Task 2: Rewrite `selectMentionResult` with polling and graceful fallback

**Files:**
- Modify: `extension/content.js:2027-2075` (the `selectMentionResult` function)

The current function has two problems: (1) it only checks once after 2.5 seconds, and (2) the fallback presses Enter which can submit the comment. We need polling with Escape fallback.

- [ ] **Step 1: Replace the `selectMentionResult` function**

Replace the function starting at line 2027 with:

```javascript
    selectMentionResult: function (field, pageName, callback) {
      var self = this;
      var maxAttempts = 10; // 10 × 300ms = 3 seconds
      var attempt = 0;

      function trySelect() {
        if (self.state !== 'running') { callback(); return; }
        if (attempt >= maxAttempts) {
          // Dropdown never appeared — clean up and continue
          self.cleanupFailedMention(field, pageName, callback);
          return;
        }
        attempt++;

        var result = self.findMentionDropdown(pageName);
        if (result) {
          humanMouseMove(result, function () {
            result.click();
            // Wait for LinkedIn to insert the mention chip
            bgTimeout(callback, 600);
          });
        } else {
          bgTimeout(trySelect, 300);
        }
      }

      trySelect();
    },
```

- [ ] **Step 2: Commit**

```bash
git add extension/content.js
git commit -m "fix: rewrite selectMentionResult with polling loop and dropdown finder"
```

---

### Task 3: Add `findMentionDropdown` helper with updated LinkedIn selectors

**Files:**
- Modify: `extension/content.js` — add new method after `selectMentionResult`

This method searches for LinkedIn's mention dropdown using broad selectors. LinkedIn renders the dropdown as a floating container near the editor. The selectors need to cover the current DOM structure.

- [ ] **Step 1: Add `findMentionDropdown` method**

Insert this method immediately after `selectMentionResult` (after the closing `},` of that function):

```javascript
    findMentionDropdown: function (pageName) {
      // LinkedIn mention dropdown selectors — broad coverage for current DOM
      var linkedInSelectors = [
        // Primary: typeahead/results container with list items
        '.mentions-search-results [role="option"]',
        '.mentions-search-results li',
        '[class*="typeahead-v2"] [role="option"]',
        '[class*="typeahead-v2"] li',
        '[class*="typeahead"] [role="option"]',
        '[class*="typeahead"] li',
        // Secondary: generic listbox options
        '[role="listbox"] [role="option"]',
        '.entity-list [role="option"]',
        '.entity-list li',
        // Broad fallback: any visible popup with options near the editor
        '[class*="mentions"] [role="option"]',
        '[class*="mention"] [role="option"]',
        '[class*="search-results"] [role="option"]',
        '[class*="search-results"] li'
      ];

      for (var i = 0; i < linkedInSelectors.length; i++) {
        var items = document.querySelectorAll(linkedInSelectors[i]);
        for (var j = 0; j < items.length; j++) {
          var item = items[j];
          if (item.offsetParent !== null && item.offsetHeight > 0) {
            // Prefer items whose text matches the page name
            var text = (item.textContent || '').toLowerCase();
            if (text.indexOf(pageName.toLowerCase()) !== -1) {
              return item;
            }
          }
        }
      }

      // If no text match found, return first visible item from any matching selector
      for (var k = 0; k < linkedInSelectors.length; k++) {
        var els = document.querySelectorAll(linkedInSelectors[k]);
        for (var m = 0; m < els.length; m++) {
          if (els[m].offsetParent !== null && els[m].offsetHeight > 0) {
            return els[m];
          }
        }
      }

      return null;
    },
```

- [ ] **Step 2: Verify the method is properly placed inside the automation engine object**

Run: `grep -n "findMentionDropdown\|selectMentionResult\|cleanupFailedMention" "D:/Coding/Social Media Agent/extension/content.js"`

Expected: All three method names appear, with `findMentionDropdown` after `selectMentionResult`.

- [ ] **Step 3: Commit**

```bash
git add extension/content.js
git commit -m "feat: add findMentionDropdown with broad LinkedIn selector coverage"
```

---

### Task 4: Add `cleanupFailedMention` for graceful fallback

**Files:**
- Modify: `extension/content.js` — add new method after `findMentionDropdown`

When the dropdown never appears, we need to clean up: press Escape to dismiss any partial mention state, then the automation continues typing the rest of the comment. The `@PageName` text stays as plain text in the editor — no broken chip, no premature submission.

- [ ] **Step 1: Add `cleanupFailedMention` method**

Insert this method immediately after `findMentionDropdown`:

```javascript
    cleanupFailedMention: function (field, pageName, callback) {
      // Press Escape to dismiss any partial mention popup
      field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', keyCode: 27 }));
      field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Escape', keyCode: 27 }));
      // Continue — the @PageName text remains as plain text
      bgTimeout(callback, 300);
    },
```

- [ ] **Step 2: Commit**

```bash
git add extension/content.js
git commit -m "fix: add cleanupFailedMention — Escape fallback instead of Enter"
```

---

### Task 5: Update the AI mention prompt in background.js

**Files:**
- Modify: `extension/background.js:394-398`

The current prompt tells the AI to write the page name as a plain word and not use `@`. We need to additionally tell the AI to place the page name in a natural mid-sentence position (not at the very start or end of the comment), because the mention needs surrounding text for the automation to split correctly.

- [ ] **Step 1: Update the mention prompt**

Find this block at line ~395 in `background.js`:

```javascript
  if (mentionPages && mentionPages.length > 0) {
    systemLines.push('');
    systemLines.push('You MUST naturally include the word "' + mentionPages[0] + '" somewhere in your comment. Work it into the sentence naturally, as if you casually referenced it. For example: "this is exactly what we deal with at ' + mentionPages[0] + '" or "' + mentionPages[0] + ' handles this kind of thing". Do NOT use the @ symbol. Just write the name as a plain word.');
  }
```

Replace with:

```javascript
  if (mentionPages && mentionPages.length > 0) {
    systemLines.push('');
    systemLines.push('You MUST naturally include the word "' + mentionPages[0] + '" somewhere in your comment, NOT at the very start or very end. Place it mid-sentence so there is text both before and after it. Work it in naturally, as if you casually referenced it. For example: "this is exactly what we deal with at ' + mentionPages[0] + ' and it saves hours" or "tools like ' + mentionPages[0] + ' handle this kind of thing really well". Do NOT use the @ symbol. Just write the name as a plain word.');
  }
```

- [ ] **Step 2: Commit**

```bash
git add extension/background.js
git commit -m "fix: update mention prompt to ensure mid-sentence placement"
```

---

### Task 6: Manual testing on LinkedIn

**Files:** None — manual browser testing

This is a Chrome extension that manipulates live LinkedIn DOM. There are no automated tests possible for this — it must be verified manually.

- [ ] **Step 1: Load the updated extension**

1. Open `chrome://extensions/` in Chrome
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `extension/` folder (or click the reload icon if already loaded)
4. Open the extension popup, go to LinkedIn tab
5. In the "Mention Pages" textarea, type `Periscale` (one line)
6. Click "Save Settings"

- [ ] **Step 2: Test the mention on a LinkedIn post**

1. Navigate to LinkedIn feed
2. Start the autopilot automation (or manually trigger AI on a comment field)
3. Verify the generated comment contains "Periscale" as a plain word mid-sentence
4. Watch the typing: when it reaches "Periscale", it should type `@` first, then `Periscale` character by character
5. Verify LinkedIn's mention dropdown appears
6. Verify the first result is clicked/selected
7. Verify the submitted comment shows a blue mention chip for the page

- [ ] **Step 3: Test the fallback**

1. In the "Mention Pages" textarea, type a page name that doesn't exist (e.g., `ZZZNonexistentPage123`)
2. Save settings
3. Trigger AI comment on a post
4. Verify: when the dropdown doesn't appear after ~3 seconds, the comment continues typing
5. Verify: no premature submission (no Enter key), the comment is submitted normally after all text is typed

---

## Self-Review

**Spec coverage:**
- Root cause 1 (event sequences): Covered in Task 1 — `insertMention` now types `@` via `document.execCommand('insertText')` with explicit `input` event, then types page name via `typeChars`
- Root cause 2 (outdated selectors): Covered in Task 3 — broad selector set in `findMentionDropdown`
- Root cause 3 (Enter fallback): Covered in Task 4 — `cleanupFailedMention` uses Escape instead of Enter
- AI prompt mid-sentence placement: Covered in Task 5
- Graceful degradation: Covered in Task 4 + Task 6 fallback test
- LinkedIn-only scope: Yes, no Facebook/X/Reddit changes

**Placeholder scan:** No TBDs, TODOs, or "add appropriate" patterns. All code blocks are complete.

**Type consistency:** `insertMention(field, pageName, callback)` now passes `pageName` to `selectMentionResult(field, pageName, callback)` which passes it to `findMentionDropdown(pageName)` and `cleanupFailedMention(field, pageName, callback)`. All signatures match.
