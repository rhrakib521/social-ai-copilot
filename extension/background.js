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
  var now = Math.floor(Date.now() / 1000);

  var header = base64urlEncode(JSON.stringify({ alg: 'HS256', sign_type: 'SIGN' }));
  var payload = base64urlEncode(JSON.stringify({
    api_key: id,
    exp: now + 3600,
    timestamp: now
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

async function callGLM(messages, options) {
  var apiKey = options.apiKey;
  var model = options.glmModel || 'glm-4-flash';
  var maxTokens = options.maxTokens || 300;

  // Generate JWT token for id.secret format keys, or use key directly
  var token = await generateGLMToken(apiKey);
  // Zhipu API: JWT tokens from id.secret format are sent without "Bearer " prefix.
  // Direct API keys (no dots) use "Bearer " prefix.
  var authHeader = apiKey.includes('.') ? token : 'Bearer ' + token;

  var response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader
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

async function callGemini(messages, options) {
  var apiKey = options.apiKey;
  var model = options.geminiModel || 'gemini-2.0-flash';
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
  professional: 'Use a professional, polished tone. Be clear, concise, and authoritative.',
  casual: 'Use a relaxed, conversational tone. Be friendly and approachable.',
  witty: 'Use a witty, clever tone. Add humor and personality while staying on topic.',
  direct: 'Use a direct, no-nonsense tone. Be straightforward and to the point.'
};

var TASK_INSTRUCTIONS = {
  reply: 'Write a reply to the post or comment provided in the context below.',
  comment: 'Write a comment on the post provided in the context below. Add a new perspective or real-world example, do not just summarize.',
  post: 'Write a new original post based on the topic or draft provided in the context. Make it structured and engaging.',
  rewrite: 'Rewrite and improve the text provided in the context below. Improve clarity without changing the core meaning.',
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
    '- Match the language of the input context.',
    '- Keep the response appropriate for the platform and its typical content length.',
    '- If context includes a specific question, answer it directly.',
    '- Do not make up facts or quotes that are not in the provided context.',
    '- No hashtags unless explicitly requested.',
    '- No emojis unless the tone is casual.',
    '- Write with a slightly imperfect human tone. Avoid robotic phrasing.',
    '- Never use filler phrases like "As a...", "In my opinion...", or "Great post!"'
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
    var commentLines = context.nearbyComments.map(function (c, i) {
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

// ── Settings ──

var DEFAULT_SETTINGS = {
  provider: 'openai',
  authMode: 'user_key',
  apiKey: '',
  openaiModel: 'gpt-4o-mini',
  glmModel: 'glm-4-flash',
  geminiModel: 'gemini-2.5-flash',
  deepseekModel: 'deepseek-chat',
  qwenModel: 'qwen-plus',
  backendToken: '',
  defaultTone: 'professional',
  platforms: { linkedin: true, facebook: true, x: true, reddit: true }
};

async function getSettings() {
  return new Promise(function (resolve) {
    chrome.storage.local.get('socialAiCopilot_settings', function (result) {
      var stored = result.socialAiCopilot_settings || {};
      resolve({
        ...DEFAULT_SETTINGS,
        ...stored,
        platforms: { ...DEFAULT_SETTINGS.platforms, ...(stored.platforms || {}) }
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
          data.personality
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
      var merged = { ...current, ...message.data, platforms: { ...current.platforms, ...(message.data.platforms || {}) } };
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
