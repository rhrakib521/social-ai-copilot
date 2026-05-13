// background.js
// Service worker for Social AI Copilot.
// Handles AI generation requests, provider dispatch, history, and keyboard shortcuts.

// ── GLM JWT Token Generation ──
// Zhipu AI API keys in {id}.{secret} format require JWT generation.

function base64urlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function arrayBufferToBase64(buffer) {
  var bytes = new Uint8Array(buffer);
  var binary = '';
  for (var i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateGLMToken(apiKey) {
  var parts = apiKey.split('.');
  if (parts.length !== 2) {
    // Not in id.secret format — use as-is (newer direct keys)
    return apiKey;
  }

  var id = parts[0];
  var secret = parts[1];
  // SDK uses millisecond timestamps: int(round(time.time() * 1000))
  var nowMs = Date.now();

  var header = base64urlEncode(JSON.stringify({ alg: 'HS256', sign_type: 'SIGN' }));
  var payload = base64urlEncode(JSON.stringify({
    api_key: id,
    exp: nowMs + 210000,   // 210 seconds (3.5 min) in milliseconds
    timestamp: nowMs
  }));

  var message = header + '.' + payload;
  var encoder = new TextEncoder();

  var cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  var signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return message + '.' + arrayBufferToBase64(signature);
}

// ── Provider implementations (inlined for MV3 service worker) ──

async function callOpenAI(messages, options) {
  var apiKey = options.apiKey;
  var model = options.openaiModel || 'gpt-4o-mini';
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

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function callGLM(messages, options) {
  var apiKey = options.apiKey;
  var model = options.glmModel || 'glm-5.1';
  var maxTokens = options.maxTokens || 300;

  // Generate JWT token for id.secret format keys, or use key directly.
  // The API accepts BOTH raw API key and JWT token as Bearer tokens.
  var token = await generateGLMToken(apiKey);
  var authHeader = 'Bearer ' + token;

  var maxRetries = 3;
  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    var response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
        'x-source-channel': 'chrome-extension'
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: maxTokens,
        temperature: 0.7
      })
    });

    if (response.status === 429 && attempt < maxRetries) {
      // Rate limited — wait with exponential backoff (2s, 4s, 8s)
      var waitMs = 2000 * Math.pow(2, attempt);
      await sleep(waitMs);
      // Regenerate token since it may have expired during wait
      token = await generateGLMToken(apiKey);
      authHeader = 'Bearer ' + token;
      continue;
    }

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
  throw new Error('GLM API rate limited after ' + maxRetries + ' retries. Please try again.');
}

async function callGemini(messages, options) {
  var apiKey = options.apiKey;
  var model = options.geminiModel || 'gemini-2.5-flash';
  var maxTokens = options.maxTokens || 300;

  // Use OpenAI-compatible endpoint for simpler integration
  var response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
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
    throw new Error('Gemini API error (' + response.status + '): ' + errorBody);
  }

  var data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error('Gemini API returned no choices.');
  }
  return data.choices[0].message.content.trim();
}

async function callDeepSeek(messages, options) {
  var apiKey = options.apiKey;
  var model = options.deepseekModel || 'deepseek-chat';
  var maxTokens = options.maxTokens || 300;

  var response = await fetch('https://api.deepseek.com/chat/completions', {
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
    throw new Error('DeepSeek API error (' + response.status + '): ' + errorBody);
  }

  var data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error('DeepSeek API returned no choices.');
  }
  return data.choices[0].message.content.trim();
}

async function callQwen(messages, options) {
  var apiKey = options.apiKey;
  var model = options.qwenModel || 'qwen-plus';
  var maxTokens = options.maxTokens || 300;

  var response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
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
    throw new Error('Qwen API error (' + response.status + '): ' + errorBody);
  }

  var data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error('Qwen API returned no choices.');
  }
  return data.choices[0].message.content.trim();
}

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

// ── Prompt building ──

var TONE_GUIDES = {
  casual: 'Write casually — friendly, relaxed, like talking to a friend.',
  funny: 'Write with humor — be witty and entertaining while staying on topic.',
  informative: 'Write to inform — clear, educational, with useful takeaways.'
};

var INSTRUCTION_PRESETS = {
  use_emojis: 'Add relevant emojis to the message.',
  ask_questions: 'End with a relevant question to encourage conversation.',
  keep_short: 'Keep responses to 1-2 sentences maximum.',
  use_hashtags: 'Include 2-3 relevant hashtags.',
  be_empathetic: 'Show empathy toward the original author.',
  include_cta: 'Add a clear call-to-action.',
  avoid_jargon: 'Use plain everyday language, no jargon.',
  professional: 'Maintain a professional, business-appropriate demeanor.'
};

var TASK_INSTRUCTIONS = {
  reply: 'Write a reply to the post or comment below. 3-4 sentences. Read the original content carefully and respond directly to what was said — do not ignore or skim over the key points.',
  comment: 'Write a comment on the post below. 3-4 sentences. Read the post content thoroughly, then add a meaningful perspective or real-world example that connects to what the author actually said.',
  quick_reply: 'Write a short, natural 2-3 line comment on the post. Read the content carefully first, then respond genuinely — like a real person who actually read the post would write. Make it feel personal and genuine. Do NOT address the author by name.',
  post: 'Write a new original post based on the topic or draft provided in the context. Make it structured and engaging.',
  rewrite: 'Rewrite and improve the text provided in the context below. Improve clarity without changing the core meaning.',
  hook: 'Write an attention-grabbing hook or opening line for a post on the topic provided. Make it stop-the-scroll worthy.',
  shorten: 'Make the text shorter and more concise while keeping the core message intact.',
  expand: 'Expand on the ideas in the text provided in the context below. Add more detail and depth.',
  grammar: 'Fix any grammar, spelling, punctuation, or phrasing errors in the text. Return only the corrected version.',
  summarize: 'Summarize the post or text provided in the context below concisely.',
  auto_classify_comment: 'STEP 1 — CLASSIFY: Read the post below. Is it about business, startups, technology, entrepreneurship, SaaS, AI, marketing, product, fundraising, leadership, career growth, or professional development? If it is clearly personal (personal life events, memes, gossip, hobbies unrelated to work, pet photos, food, travel diaries with no business angle), respond with exactly and only the word SKIP and nothing else.\nSTEP 2 — COMMENT: If the post IS business/startup related, write a short, natural 2-3 line comment. Read the content carefully first, then respond genuinely — like a real person who actually read the post would write. Do NOT address the author by name. Make it feel personal and genuine.',
  reddit_auto_comment: 'STEP 1 — CLASSIFY: Read the post. Is it about SaaS, e-commerce, startups, business, marketing, product development, entrepreneurship, tech tools, or business problems/solutions? If clearly personal (memes, hobbies, gossip, politics, personal life), respond with exactly and only the word SKIP.\nSTEP 2 — SAFETY CHECK: Is this post controversial, a heated debate, political, or emotionally charged? If yes, respond with exactly and only the word SKIP.\nSTEP 3 — COMMENT: Write a helpful, genuine comment. Keep it 3-4 lines normally, 6-7 lines when naturally sharing a longer experience. Sound like a real Redditor who genuinely wants to help. Match the subreddit vibe. Offer specific advice, share relevant experience, or ask a thoughtful follow-up. NO marketing language, NO pitches, NO call-to-action. Use simple conversational English, like chatting with a peer. Start naturally — react to what they said, never start with generic praise. Do NOT address the author by name.'
};

function buildPrompt(platform, task, tone, context, personality, contextInfo, mentionPages, instructionPresets, customInstructions, mentionMode) {
  var toneGuide = TONE_GUIDES[tone] || TONE_GUIDES.casual;
  var taskInstruction = TASK_INSTRUCTIONS[task] || TASK_INSTRUCTIONS.reply;

  var systemLines = [
    'You are Social AI Copilot, a writing assistant for social media.',
    '',
    'Platform: ' + platform,
    personality,
    '',
    'Task: ' + taskInstruction,
    '',
    'Tone: ' + toneGuide
  ];

  // Reddit business mention injection
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

  // Inject user context — force the AI to internalize and apply it
  if (contextInfo && contextInfo.trim()) {
    systemLines.push('');
    systemLines.push('IMPORTANT — Context profile you MUST embody and write through:');
    systemLines.push(contextInfo.trim());
    systemLines.push('Everything you write must reflect the above profile. Do not ignore any part of it.');
  }

  // Inject enabled instruction presets
  if (instructionPresets && instructionPresets.length > 0) {
    systemLines.push('');
    systemLines.push('Writing instructions:');
    instructionPresets.forEach(function (presetId) {
      if (INSTRUCTION_PRESETS[presetId]) {
        systemLines.push('- ' + INSTRUCTION_PRESETS[presetId]);
      }
    });
  }

  // Inject custom instructions (token-limited to ~250 tokens / ~1000 chars)
  if (customInstructions && customInstructions.trim()) {
    var truncated = customInstructions.trim();
    if (truncated.length > 1000) {
      truncated = truncated.substring(0, 1000);
    }
    systemLines.push('');
    systemLines.push('Additional instructions: ' + truncated);
  }

  systemLines.push(
    '',
    'Rules:',
    '- Output ONLY the response text. No prefixes or meta-commentary.',
    '- Match the language of the input context.',
    '- Do not make up facts or quotes not in the context.',
    '- No hashtags unless requested. No emojis unless tone is casual or funny.',
    '- Write naturally, not robotically. Avoid "As a...", "In my opinion...", "Great post!"',
    '- Do NOT mention or address the post author by name. Never say their first name.',
    '- Use simple, everyday words. No fancy vocabulary or jargon.',
    '- NO em dashes (—). Use commas or short sentences instead.',
    '- Avoid AI-sounding phrases: "game-changer", "landscape", "delve", "foster", "leverage", "navigate", "realm", "testament", "tapestry", "unleash", "pave the way", "in today\'s world", "it\'s worth noting".',
    '- Avoid generic openings: "Great post!", "Spot on!", "Couldn\'t agree more!", "This!"',
    '- Keep sentences short. Talk like you\'re chatting with a friend, not writing an essay.'
  );

  // Mention pages instruction — tell AI to naturally include the page name
  if (mentionPages && mentionPages.length > 0) {
    systemLines.push('');
    systemLines.push('You MUST naturally include the word "' + mentionPages[0] + '" somewhere in your comment. Work it into the sentence naturally, as if you casually referenced it. For example: "this is exactly what we deal with at ' + mentionPages[0] + '" or "' + mentionPages[0] + ' handles this kind of thing". Do NOT use the @ symbol. Just write the name as a plain word.');
  }
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
  if (context.authorHandle) {
    userParts.push('Author handle/username: @' + context.authorHandle);
  }
  if (context.authorProfileUrl) {
    userParts.push('Author profile: ' + context.authorProfileUrl);
  }
  if (context.nearbyComments && context.nearbyComments.length > 0) {
    var commentLines = context.nearbyComments.map(function (c, i) {
      return (i + 1) + '. ' + c;
    }).join('\n');
    userParts.push('Nearby comments for context:\n' + commentLines);
  }
  if (userParts.length === 0) {
    userParts.push('No specific context was detected. Write a helpful response based on the task and tone instructions.');
  }

  var userMessage = userParts.join('\n\n');

  var maxTokens = 200;
  if (task === 'post' || task === 'expand') maxTokens = 500;
  if (task === 'quick_reply') maxTokens = 120;
  if (task === 'summarize' || task === 'shorten') maxTokens = 150;
  if (task === 'hook') maxTokens = 80;
  if (task === 'grammar') maxTokens = 400;
  if (task === 'rewrite') maxTokens = 300;
  if (task === 'auto_classify_comment') maxTokens = 150;
  if (task === 'reddit_auto_comment') maxTokens = 250;

  return {
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage }
    ],
    maxTokens: maxTokens
  };
}

// ── Settings ──

var DEFAULT_PLATFORM_SETTINGS = {
  tone: 'casual',
  activeContext: '',
  instructionPresets: [],
  customInstructions: '',
  interval: 60,
  autoSubmit: true,
  contentFilter: 'business',
  stopLimit: 0,
  engagementThresholds: {
    minReactions: 50,
    minComments: 10
  },
  mentionPages: []
};

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
  contexts: [],
  priorityTargets: [],
  platforms: { linkedin: true, facebook: true, x: true, reddit: true },
  platformSettings: {
    linkedin: {
      ...DEFAULT_PLATFORM_SETTINGS,
      engagementThresholds: { minReactions: 50, minComments: 10 }
    },
    facebook: {
      ...DEFAULT_PLATFORM_SETTINGS,
      engagementThresholds: { minReactions: 30, minComments: 5 }
    },
    x: {
      ...DEFAULT_PLATFORM_SETTINGS,
      engagementThresholds: { minLikes: 100, minRetweets: 20 }
    },
    reddit: {
      ...DEFAULT_PLATFORM_SETTINGS,
      engagementThresholds: { minUpvotes: 50, minComments: 10 },
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
  }
};

function migrateSettings(stored) {
  if (stored.platformSettings) {
    var platforms = ['linkedin', 'facebook', 'x', 'reddit'];
    platforms.forEach(function (p) {
      if (!stored.platformSettings[p]) return;
      if (!stored.platformSettings[p].instructionPresets) {
        stored.platformSettings[p].instructionPresets = [];
      }
      if (stored.platformSettings[p].customInstructions === undefined) {
        stored.platformSettings[p].customInstructions = '';
      }
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
    });
    return stored;
  }

  var ps = {};
  var platforms = ['linkedin', 'facebook', 'x', 'reddit'];
  platforms.forEach(function (p) {
    var defaults = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.platformSettings[p]));
    defaults.tone = stored.defaultTone || 'casual';
    defaults.interval = stored.autoInterval || 60;
    defaults.autoSubmit = stored.autoSubmit !== false;
    defaults.contentFilter = stored.contentFilter || 'business';
    defaults.stopLimit = stored.autoStopLimit || 0;
    defaults.mentionPages = stored.autoMentionPages || [];
    if (stored.engagementThresholds && stored.engagementThresholds[p]) {
      defaults.engagementThresholds = { ...defaults.engagementThresholds, ...stored.engagementThresholds[p] };
    }
    ps[p] = defaults;
  });
  stored.platformSettings = ps;
  return stored;
}

async function getSettings() {
  return new Promise(function (resolve) {
    chrome.storage.local.get('socialAiCopilot_settings', function (result) {
      var stored = result.socialAiCopilot_settings || {};
      stored = migrateSettings(stored);
      resolve({
        ...DEFAULT_SETTINGS,
        ...stored,
        platforms: { ...DEFAULT_SETTINGS.platforms, ...(stored.platforms || {}) },
        platformSettings: { ...DEFAULT_SETTINGS.platformSettings, ...(stored.platformSettings || {}) }
      });
    });
  });
}

// ── History ──

async function saveHistory(entry) {
  return new Promise(function (resolve) {
    chrome.storage.local.get('socialAiCopilot_history', function (result) {
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

// ── Message handler: AI generation ──

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === 'generate') {
    (async function () {
      try {
        var data = message.data;
        var settings = await getSettings();

        var promptResult = buildPrompt(
          data.platform,
          data.task,
          data.tone,
          data.context,
          data.personality,
          data.contextInfo || '',
          data.mentionPages || [],
          data.instructionPresets || [],
          data.customInstructions || '',
          data.mentionMode
        );

        var providerOptions = {
          apiKey: settings.apiKey,
          openaiModel: settings.openaiModel,
          glmModel: settings.glmModel,
          geminiModel: settings.geminiModel,
          deepseekModel: settings.deepseekModel,
          qwenModel: settings.qwenModel,
          backendToken: settings.backendToken,
          maxTokens: promptResult.maxTokens
        };

        var text = '';

        if (settings.provider === 'openai') {
          if (!settings.apiKey) throw new Error('OpenAI API key not configured. Open the extension settings to add it.');
          text = await callOpenAI(promptResult.messages, providerOptions);
        } else if (settings.provider === 'glm') {
          if (!settings.apiKey) throw new Error('GLM API key not configured. Open the extension settings to add it.');
          text = await callGLM(promptResult.messages, providerOptions);
        } else if (settings.provider === 'gemini') {
          if (!settings.apiKey) throw new Error('Gemini API key not configured. Open the extension settings to add it.');
          text = await callGemini(promptResult.messages, providerOptions);
        } else if (settings.provider === 'deepseek') {
          if (!settings.apiKey) throw new Error('DeepSeek API key not configured. Open the extension settings to add it.');
          text = await callDeepSeek(promptResult.messages, providerOptions);
        } else if (settings.provider === 'qwen') {
          if (!settings.apiKey) throw new Error('Qwen API key not configured. Open the extension settings to add it.');
          text = await callQwen(promptResult.messages, providerOptions);
        } else if (settings.provider === 'backend') {
          if (!settings.backendToken) throw new Error('Backend token not configured. Open the extension settings to add it.');
          text = await callBackendProxy(promptResult.messages, providerOptions);
        } else {
          throw new Error('Unknown provider: ' + settings.provider);
        }

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
    return true; // Keep channel open for async response
  }

  if (message.type === 'getSettings') {
    getSettings().then(sendResponse);
    return true;
  }

  if (message.type === 'saveSettings') {
    (async function () {
      var current = await getSettings();
      var merged = {
        ...current,
        ...message.data,
        platforms: { ...current.platforms, ...(message.data.platforms || {}) }
      };
      if (message.data.platformSettings) {
        merged.platformSettings = { ...current.platformSettings };
        var pKeys = Object.keys(message.data.platformSettings);
        for (var i = 0; i < pKeys.length; i++) {
          var pk = pKeys[i];
          merged.platformSettings[pk] = { ...current.platformSettings[pk], ...message.data.platformSettings[pk] };
          if (message.data.platformSettings[pk].engagementThresholds) {
            merged.platformSettings[pk].engagementThresholds = {
              ...current.platformSettings[pk].engagementThresholds,
              ...message.data.platformSettings[pk].engagementThresholds
            };
          }
        }
      }
      chrome.storage.local.set({ socialAiCopilot_settings: merged }, function () {
        sendResponse({ ok: true });
      });
    })();
    return true;
  }

  if (message.type === 'getHistory') {
    chrome.storage.local.get('socialAiCopilot_history', function (result) {
      sendResponse(result.socialAiCopilot_history || []);
    });
    return true;
  }

  if (message.type === 'clearHistory') {
    chrome.storage.local.set({ socialAiCopilot_history: [] }, function () {
      sendResponse({ ok: true });
    });
    return true;
  }
});

// ── Keyboard shortcut ──

chrome.commands.onCommand.addListener(function (command) {
  if (command === 'trigger-ai') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'triggerShortcut' }, function () {
          if (chrome.runtime.lastError) {
            console.log('Social AI Copilot: Could not reach content script:', chrome.runtime.lastError.message);
          }
        });
      }
    });
  }
});
