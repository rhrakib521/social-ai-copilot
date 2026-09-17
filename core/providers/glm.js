// core/providers/glm.js
// GLM (Zhipu AI) API adapter.

const GLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

function glmThinkingCanDisable(model) {
  const m = (model || '').toLowerCase();
  if (m.indexOf('glm-5.3') === 0) return false;
  return m.indexOf('glm-5') === 0 ||
    m.indexOf('glm-4.5') === 0 ||
    m.indexOf('glm-4.6') === 0 ||
    m.indexOf('glm-4.7') === 0 ||
    m.indexOf('glm-z1') === 0;
}

/**
 * Call the GLM Chat Completions API.
 * @param {Array<{role: string, content: string}>} messages
 * @param {{ apiKey: string, model?: string, maxTokens?: number }} options
 * @returns {Promise<string>}
 */
export async function generate(messages, options) {
  const apiKey = options.apiKey;
  const model = options.model || 'glm-4-flash';
  const maxTokens = options.maxTokens || 300;

  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.7
  };
  if (glmThinkingCanDisable(model)) {
    body.thinking = { type: 'disabled' };
  } else if ((model || '').toLowerCase().indexOf('glm-5.3') === 0) {
    // glm-5.3 cannot disable thinking — without a large budget the reasoning
    // consumes everything and message.content comes back empty.
    body.max_tokens = Math.max(maxTokens, 3072);
  }

  const response = await fetch(options.endpoint || GLM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error('GLM API error (' + response.status + '): ' + errorBody);
  }

  const data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error('GLM API returned no choices.');
  }

  const msg = data.choices[0].message || {};
  // Do NOT fall back to reasoning_content — posting the model's internal
  // monologue as a comment is worse than failing.
  const text = msg.content && String(msg.content).trim();
  if (!text) {
    throw new Error('GLM API returned empty content — the reasoning used up the token budget. Try a non-reasoning model or raise the token limit.');
  }
  return text;
}
