// core/providers/glm.js
// GLM (Zhipu AI) API adapter.

const GLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

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

  const response = await fetch(GLM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error('GLM API error (' + response.status + '): ' + errorBody);
  }

  const data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error('GLM API returned no choices.');
  }

  return data.choices[0].message.content.trim();
}
