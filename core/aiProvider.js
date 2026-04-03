// core/aiProvider.js
// Provider registry and dispatcher.
// Providers are registered by ID and dispatched by the settings' provider field.

/** @type {Map<string, { generate: Function }>} */
const providers = new Map();

/**
 * Register a provider adapter.
 * @param {string} id
 * @param {{ generate: (messages: Array, options: object) => Promise<string> }} adapter
 */
export function registerProvider(id, adapter) {
  if (!adapter || typeof adapter.generate !== 'function') {
    throw new Error('Provider "' + id + '" must export a generate function.');
  }
  providers.set(id, adapter);
}

/**
 * Call a registered provider's generate function.
 * @param {string} providerId
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} options
 * @returns {Promise<string>}
 */
export async function callProvider(providerId, messages, options) {
  const provider = providers.get(providerId);
  if (!provider) {
    throw new Error('Unknown provider: "' + providerId + '". Registered: ' + Array.from(providers.keys()).join(', '));
  }
  return provider.generate(messages, options);
}

/**
 * List all registered provider IDs.
 * @returns {string[]}
 */
export function listProviders() {
  return Array.from(providers.keys());
}
