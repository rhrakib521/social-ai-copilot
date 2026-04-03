// utils/dom.js
// Safe DOM utilities for text insertion and selection reading.

/**
 * Insert text at the current cursor position inside a contenteditable element
 * or textarea. Moves the cursor to the end of the inserted text.
 * @param {HTMLElement} field - The target editable element.
 * @param {string} text - The text to insert.
 */
export function insertTextAtCursor(field, text) {
  field.focus();

  // Handle <textarea> and <input> elements
  if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const value = field.value;
    field.value = value.substring(0, start) + text + value.substring(end);
    field.selectionStart = field.selectionEnd = start + text.length;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  // Handle contenteditable elements
  const selection = window.getSelection();
  if (!selection.rangeCount) {
    const textNode = document.createTextNode(text);
    field.appendChild(textNode);
    const range = document.createRange();
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const success = document.execCommand('insertText', false, text);

  if (!success) {
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Get the currently selected text on the page.
 * @returns {string}
 */
export function getSelectedText() {
  const selection = window.getSelection();
  return selection ? selection.toString().trim() : '';
}
