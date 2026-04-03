// core/contextExtractor.js
// Extracts context from the page: the nearest post, author, comments, and selected text.

/**
 * Walk up the DOM tree from the active element to find the nearest ancestor
 * matching one of the given selectors.
 * @param {HTMLElement} element
 * @param {string[]} selectors
 * @param {number} [maxDepth=15]
 * @returns {HTMLElement|null}
 */
function findNearestAncestor(element, selectors, maxDepth) {
  maxDepth = maxDepth || 15;
  var current = element;
  var depth = 0;
  while (current && current !== document.body && depth < maxDepth) {
    for (var i = 0; i < selectors.length; i++) {
      if (current.matches && current.matches(selectors[i])) {
        return current;
      }
    }
    current = current.parentElement;
    depth++;
  }
  return null;
}

/**
 * Safely extract text content from an element, limiting to a max length.
 * @param {HTMLElement} el
 * @param {number} [maxLength=2000]
 * @returns {string}
 */
function extractText(el, maxLength) {
  maxLength = maxLength || 2000;
  if (!el) return '';
  var text = (el.innerText || el.textContent || '').trim();
  if (text.length > maxLength) {
    text = text.substring(0, maxLength) + '...';
  }
  return text;
}

/**
 * Extract context around the currently focused editable field.
 * @param {HTMLElement} activeElement
 * @param {{ editableFields: string[], postContainers: string[], authorSelector: string }} platformConfig
 * @returns {{ postText: string, author: string, nearbyComments: string[], selectedText: string }}
 */
export function extractContext(activeElement, platformConfig) {
  var result = {
    postText: '',
    author: '',
    nearbyComments: [],
    selectedText: ''
  };

  if (!activeElement || !platformConfig) return result;

  // Get user-selected text
  var selection = window.getSelection();
  if (selection && selection.toString().trim()) {
    result.selectedText = selection.toString().trim();
  }

  // Find the nearest post container
  var postEl = findNearestAncestor(activeElement, platformConfig.postContainers, 20);

  if (postEl) {
    result.postText = extractText(postEl);

    if (platformConfig.authorSelector) {
      var authorEls = postEl.querySelectorAll(platformConfig.authorSelector);
      if (authorEls.length > 0) {
        result.author = (authorEls[0].innerText || authorEls[0].textContent || '').trim();
      }
    }

    // Collect nearby comments (sibling post containers nearby)
    var siblingComments = postEl.parentElement ? postEl.parentElement.children : [];
    var comments = [];
    for (var i = 0; i < siblingComments.length && comments.length < 5; i++) {
      var sibling = siblingComments[i];
      if (sibling !== postEl) {
        for (var j = 0; j < platformConfig.postContainers.length; j++) {
          if (sibling.matches && sibling.matches(platformConfig.postContainers[j])) {
            var commentText = extractText(sibling, 500);
            if (commentText) comments.push(commentText);
            break;
          }
        }
      }
    }
    result.nearbyComments = comments;
  } else {
    // No post container found — use the active element's own content
    var fieldText = extractText(activeElement, 1000);
    if (fieldText) result.postText = fieldText;
  }

  return result;
}

/**
 * Pick a specific post element by index from all matching post containers on the page.
 * @param {{ postContainers: string[], authorSelector: string }} platformConfig
 * @param {number} index - 0-based index of the post to select.
 * @returns {{ postText: string, author: string }}
 */
export function pickPost(platformConfig, index) {
  var result = { postText: '', author: '' };
  if (!platformConfig || !platformConfig.postContainers) return result;

  var allPosts = [];
  for (var i = 0; i < platformConfig.postContainers.length; i++) {
    var found = document.querySelectorAll(platformConfig.postContainers[i]);
    for (var j = 0; j < found.length; j++) {
      allPosts.push(found[j]);
    }
  }

  if (index < 0 || index >= allPosts.length) return result;

  var postEl = allPosts[index];
  result.postText = extractText(postEl);

  if (platformConfig.authorSelector) {
    var authorEls = postEl.querySelectorAll(platformConfig.authorSelector);
    if (authorEls.length > 0) {
      result.author = (authorEls[0].innerText || authorEls[0].textContent || '').trim();
    }
  }

  return result;
}
