# Platform-Specific Custom Instructions

## Overview

Add per-platform custom instructions to the Social AI Copilot extension, consisting of toggleable predefined instruction presets and a free-text custom instructions field. Tone, context, and instructions live exclusively in each platform tab — not in the General tab.

## Motivation

Different social media platforms require different writing styles. A LinkedIn reply should sound different from an X post. Currently, users can set tone and context per platform, but have no way to add custom writing rules or quick behavioral toggles.

## Instruction Presets

Eight predefined presets, each represented as a checkbox in the platform UI:

| ID | Label | Prompt Directive |
|---|---|---|
| `use_emojis` | Use emojis | "Add relevant emojis to the message." |
| `ask_questions` | Ask follow-up questions | "End with a relevant question to encourage conversation." |
| `keep_short` | Keep it short | "Keep responses to 1-2 sentences maximum." |
| `use_hashtags` | Use hashtags | "Include 2-3 relevant hashtags." |
| `be_empathetic` | Be empathetic | "Show empathy toward the original author." |
| `include_cta` | Include call-to-action | "Add a clear call-to-action." |
| `avoid_jargon` | Avoid jargon | "Use plain everyday language, no jargon." |
| `professional` | Professional tone | "Maintain a professional, business-appropriate demeanor." |

Presets are short directives (~5-8 tokens each) injected into the system prompt.

## Data Model

Two new fields added to each platform in `platformSettings`:

```javascript
platformSettings: {
  linkedin: {
    tone: 'casual',
    activeContext: '',
    instructionPresets: [],      // array of preset IDs (strings)
    customInstructions: '',      // free-text string
    // ... existing fields unchanged
  }
}
```

### Migration

Existing settings receive defaults during migration:
- `instructionPresets: []`
- `customInstructions: ''`

No data loss for existing users.

## UI Layout

Each platform tab (LinkedIn, Facebook, X, Reddit) gets the following structure after the existing Tone and Active Context fields:

```
[Tone dropdown]              (existing)
[Active Context dropdown]    (existing)
--- Instruction Presets ---
[✓] Use emojis
[ ] Ask follow-up questions
[✓] Keep it short
[ ] Use hashtags
[ ] Be empathetic
[ ] Include call-to-action
[✓] Avoid jargon
[ ] Professional tone
--- Custom Instructions ---
[Textarea, 3-4 rows, for free-text rules]
```

- Checkboxes use compact styling to fit the popup width
- Textarea provides enough room for multi-line instructions
- No changes to the General tab

## Prompt Integration

In `buildPrompt()`, after tone and context are injected:

1. **Preset expansion**: Only enabled presets are included. Each preset expands to its short directive text.
2. **Custom instructions**: Appended as-is, prefixed with "Additional instructions:".
3. **Ordering**: Tone → Context → Presets → Custom instructions. Last instruction wins for any conflicts.

### Token Optimization

- Preset directives: ~5-8 tokens each
- Custom instructions cap: ~250 tokens
- Total instruction block budget: ~400 tokens
- If custom text exceeds the budget, it is truncated with a visual indicator in the UI

### System Prompt Structure

```
[System identity]
Platform: <platform>
[Personality]
Task: <task instruction>
Tone: <tone guide>
[Context profile if active]
[Enabled preset directives]
Additional instructions: <custom text>
```

## Files Changed

| File | Change |
|---|---|
| `background.js` | Add `INSTRUCTION_PRESETS` map. Add `instructionPresets` and `customInstructions` to DEFAULT_SETTINGS per platform. Update migration logic. Update `buildPrompt()` to accept and inject presets + custom text. |
| `popup.html` | Add checkbox group (8 checkboxes) and textarea in each of the 4 platform panel divs. |
| `popup.js` | Load/save `instructionPresets` and `customInstructions` per platform. Checkbox event handlers. |
| `content.js` | Read `instructionPresets` and `customInstructions` from platform settings and pass to `buildPrompt()`. |

## Edge Cases

- **Preset + tone conflict** (e.g., tone="funny" + preset="professional"): Preset overrides. Last instruction wins.
- **Empty instructions**: If no presets are checked and no custom text, the instruction block is omitted entirely — no wasted tokens.
- **Very long custom text**: Truncated at ~250 tokens with a UI indicator showing the limit.
- **Migration from older versions**: Defaults are empty — no behavior change for existing users until they configure instructions.
