// utils/storage.js
// Provides typed access to chrome.storage.local for settings and generation history.

const SETTINGS_KEY = 'socialAiCopilot_settings';
const HISTORY_KEY = 'socialAiCopilot_history';
const MAX_HISTORY = 100;

const DEFAULT_SETTINGS = {
  provider: 'openai',
  authMode: 'user_key',
  apiKey: '',
  backendToken: '',
  defaultTone: 'professional',
  platforms: {
    linkedin: true,
    facebook: true,
    x: true,
    reddit: true
  }
};

/**
 * Read the full settings object from chrome.storage.local.
 * Returns a copy merged with DEFAULT_SETTINGS so every field is always present.
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(SETTINGS_KEY, (result) => {
      const stored = result[SETTINGS_KEY] || {};
      resolve({ ...DEFAULT_SETTINGS, ...stored, platforms: { ...DEFAULT_SETTINGS.platforms, ...(stored.platforms || {}) } });
    });
  });
}

/**
 * Merge partial settings into the stored settings and persist.
 * @param {Partial<typeof DEFAULT_SETTINGS>} partial
 * @returns {Promise<void>}
 */
export async function saveSettings(partial) {
  const current = await getSettings();
  const merged = { ...current, ...partial, platforms: { ...current.platforms, ...(partial.platforms || {}) } };
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SETTINGS_KEY]: merged }, resolve);
  });
}

/**
 * Retrieve the full generation history array (newest first).
 * Each entry: { id, timestamp, platform, task, tone, input, output }
 * @returns {Promise<Array>}
 */
export async function getHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get(HISTORY_KEY, (result) => {
      resolve(result[HISTORY_KEY] || []);
    });
  });
}

/**
 * Append a new entry to history. FIFO cap at MAX_HISTORY (100).
 * @param {{ platform: string, task: string, tone: string, input: string, output: string }} entry
 * @returns {Promise<void>}
 */
export async function saveHistory(entry) {
  const history = await getHistory();
  const newEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    ...entry
  };
  history.unshift(newEntry);
  if (history.length > MAX_HISTORY) {
    history.length = MAX_HISTORY;
  }
  return new Promise((resolve) => {
    chrome.storage.local.set({ [HISTORY_KEY]: history }, resolve);
  });
}
