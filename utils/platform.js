// utils/platform.js
// Detects which social platform the user is on and returns its DOM configuration.

const PLATFORMS = {
  linkedin: {
    editableFields: [
      '.ql-editor[contenteditable="true"]',
      '.msg-form__contenteditable[contenteditable="true"]',
      '.comments-comment-texteditor[contenteditable="true"]',
      '.comments-comment-box [contenteditable="true"]',
      '[role="textbox"][contenteditable="true"]',
      '[data-placeholder*="post"]',
      '[aria-label*="Post"]',
      '[aria-label*="comment"]',
      '[aria-label*="message"]',
      '.editor-content [contenteditable="true"]',
      '.share-box [contenteditable="true"]',
      '.create-post [contenteditable="true"]',
      '[contenteditable="true"][aria-label*="Write"]'
    ],
    postContainers: [
      '.feed-shared-update-v2',
      '.feed-shared-celebration-v2',
      '.occludable-update',
      '[data-urn*="urn:li:activity"]',
      '[data-urn*="urn:li:ugcPost"]',
      '[data-urn*="urn:li:share"]',
      '.comments-comments-list__comment-item',
      '.comments-comment-item',
      '.msg-s-message-listevent',
      '.feed-shared-update',
      '[data-id*="urn:li:activity"]'
    ],
    // Selectors that target ONLY the actual post/comment text content area.
    // Updated June 2026 to cover the new text-view-model-migration patterns.
    postContentSelector: '.update-components-text .break-words, .update-components-text, .attributed-text-segment-list__content, .feed-shared-inline-show-more-text, .feed-shared-update-v2__description .break-words, .text-view-model, .text-view-model .break-words, [data-test-id="share-text"], .attributed-text-segment-list__content .break-words, .feed-shared-text, .feed-shared-update-v2__commentary, .comments-comment-item__comment-text, .comments-comment-text',
    authorSelector: '.update-components-actor__title span[dir="ltr"], .update-components-actor__name, .comments-post-meta__actor span[dir="ltr"], .update-components-actor__title, .feed-shared-actor__title, .feed-shared-actor__name, .update-components-actor span[dir="ltr"], [data-control-name="actor"] span[dir="ltr"]',
    personality: 'You are writing for LinkedIn. The tone should be professional and thought-leadership oriented. Use industry-relevant language. Keep content polished and suitable for a business network.'
  },

  facebook: {
    editableFields: [
      '[aria-label*="Post"][role="textbox"]',
      '[aria-label*="comment"][role="textbox"]',
      '[data-text="true"]',
      '[contenteditable="true"][aria-label*="Write"]'
    ],
    postContainers: [
      '[data-pagelet*="feed"] [role="article"]',
      '[aria-label*="Comment"]'
    ],
    authorSelector: 'a[role="link"] span a span, h4 a span',
    personality: 'You are writing for Facebook. The tone should be friendly, conversational, and engaging. Content should feel natural and encourage interaction.'
  },

  x: {
    editableFields: [
      '[data-testid="tweetTextarea_0"]',
      '[data-testid="tweetTextarea_1"]',
      '.public-DraftEditor-content[contenteditable="true"]',
      '[placeholder*="Tweet"]',
      '[aria-label*="Tweet text"]'
    ],
    postContainers: [
      '[data-testid="tweet"]',
      'article[data-testid="tweet"]'
    ],
    postContentSelector: '[data-testid="tweetText"], .tweet-text, [lang] [dir="auto"]',
    authorSelector: '[data-testid="User-Name"] a span',
    personality: 'You are writing for X (Twitter). Be concise, punchy, and impactful. Respect the character-limited culture even when writing longer posts.'
  },

  reddit: {
    editableFields: [
      '.public-DraftEditor-content[contenteditable="true"]',
      'textarea[name="text"]',
      'textarea#comment-textarea',
      '[contenteditable="true"]',
      '.md textarea'
    ],
    postContainers: [
      '.thing.link',
      '.thing.comment',
      '[data-testid="post-container"]',
      '.Comment'
    ],
    authorSelector: '.author, a[data-testid="post_author_link"], [data-testid="comment_author_link"]',
    personality: 'You are writing for Reddit. Be authentic, knowledgeable, and community-aware. Match the subreddit culture. Avoid overly marketing language. Use proper formatting with Markdown.'
  }
};

/**
 * Detect which social platform the current page is on.
 * @param {string} url
 * @returns {'linkedin'|'facebook'|'x'|'reddit'|null}
 */
export function detectPlatform(url) {
  if (!url) return null;
  let hostname;
  try { hostname = new URL(url).hostname; } catch (e) { return null; }
  if (hostname.includes('linkedin.com')) return 'linkedin';
  if (hostname.includes('facebook.com')) return 'facebook';
  if (hostname.includes('x.com') || hostname.includes('twitter.com')) return 'x';
  if (hostname.includes('reddit.com')) return 'reddit';
  return null;
}

/**
 * Get the full platform configuration object.
 * @param {'linkedin'|'facebook'|'x'|'reddit'} platform
 * @returns {object|null}
 */
export function getFieldSelectors(platform) {
  const config = PLATFORMS[platform];
  if (!config) return null;
  return {
    editableFields: config.editableFields,
    postContainers: config.postContainers,
    postContentSelector: config.postContentSelector || null,
    authorSelector: config.authorSelector,
    personality: config.personality
  };
}

/**
 * Get the raw platform configs (used by content.js which inlines everything).
 * @returns {typeof PLATFORMS}
 */
export function getAllPlatformConfigs() {
  return PLATFORMS;
}
