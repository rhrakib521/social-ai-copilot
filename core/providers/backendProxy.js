// core/providers/backendProxy.js
// Backend proxy adapter — routes AI requests through the user's own backend server.

/**
 * Call the user's backend proxy endpoint for AI generation.
 * The backend is expected to accept a POST with { messages, options }
 * and return { text: string } on success.
 * @param {Array<{role: string, content: string}>} messages
 * @param {{ backendToken: string, backendUrl?: string, maxTokens?: number }} options
 * @returns {Promise<string>}
 */
export async function generate(messages, options) {
  const backendToken = options.backendToken;
  const backendUrl = options.backendUrl || 'https://localhost:3000/api/generate';
  const maxTokens = options.maxTokens || 300;

  const response = await fetch(backendUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + backendToken
    },
    body: JSON.stringify({
      messages,
      max_tokens: maxTokens,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error('Backend proxy error (' + response.status + '): ' + errorBody);
  }

  const data = await response.json();

  // Support multiple response formats
  if (data.text) return data.text.trim();
  if (data.choices && data.choices.length > 0 && data.choices[0].message) {
    return data.choices[0].message.content.trim();
  }
  if (data.content) return data.content.trim();

  throw new Error('Backend proxy returned unexpected response format: ' + JSON.stringify(data));
}
