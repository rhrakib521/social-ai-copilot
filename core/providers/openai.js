// core/providers/openai.js
// OpenAI Chat Completions API adapter.

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function isOpenAIReasoningModel(model) {
  const m = (model || '').toLowerCase();
  return m.indexOf('gpt-5') === 0 || /^o[0-9]/.test(m);
}

/**
 * Call the OpenAI Chat Completions API.
 * @param {Array<{role: string, content: string}>} messages
 * @param {{ apiKey: string, model?: string, maxTokens?: number }} options
 * @returns {Promise<string>}
 */
export async function generate(messages, options) {
  const apiKey = options.apiKey;
  const model = options.model || 'gpt-4o-mini';
  const maxTokens = options.maxTokens || 300;

  const body = {
    model,
    messages
  };
  if (isOpenAIReasoningModel(model)) {
    // Reasoning models (gpt-5*, o*) reject any temperature except 1,
    // and reasoning tokens count against max_completion_tokens — without
    // headroom the answer comes back empty.
    body.max_completion_tokens = Math.max(maxTokens, 2000);
  } else {
    body.temperature = 0.7;
    body.max_tokens = maxTokens;
  }

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error('OpenAI API error (' + response.status + '): ' + errorBody);
  }

  const data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error('OpenAI API returned no choices.');
  }

  const content = data.choices[0].message && data.choices[0].message.content;
  if (!content || !String(content).trim()) {
    throw new Error('OpenAI API returned empty content.');
  }
  return String(content).trim();
}
