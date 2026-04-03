// core/providers/openai.js
// OpenAI Chat Completions API adapter.

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

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

  const response = await fetch(OPENAI_URL, {
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
    throw new Error('OpenAI API error (' + response.status + '): ' + errorBody);
  }

  const data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error('OpenAI API returned no choices.');
  }

  return data.choices[0].message.content.trim();
}
