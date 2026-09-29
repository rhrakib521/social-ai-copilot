// Focused test: the automation panel's Stop button exists, appears while
// running, and calling stop() transitions the engine to 'stopped'.
// Run: node test/stop-button-harness.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

let contentSrc = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content.js'), 'utf8');
const _iifeEnd = contentSrc.lastIndexOf('})();');
contentSrc = contentSrc.slice(0, _iifeEnd) +
  '\n;try { window.__saicTest = { AutomationEngine: AutomationEngine }; } catch (e) {}\n' +
  contentSrc.slice(_iifeEnd);

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://www.linkedin.com/feed/', runScripts: 'outside-only', pretendToBeVisual: true
});
const { window } = dom;
window.chrome = {
  runtime: {
    id: 'test-ext',
    onMessage: { addListener: () => {} },
    sendMessage: (msg, cb) => setTimeout(() => cb && cb({ platforms: {}, platformSettings: {}, contexts: [], priorityTargets: [] }), 0),
    lastError: null
  },
  storage: {
    local: { get: (k, cb) => setTimeout(() => cb && cb({}), 0), set: (o, cb) => cb && setTimeout(cb, 0), remove: (k, cb) => cb && setTimeout(cb, 0) },
    onChanged: { addListener: () => {} }
  }
};
window.HTMLElement.prototype.innerText = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype, 'innerText') || { configurable: true, get: function () { return this.textContent; } };
try { Object.defineProperty(window.HTMLElement.prototype, 'innerText', { configurable: true, get: function () { return this.textContent; } }); } catch (e) {}

vm.runInContext(contentSrc, dom.getInternalVMContext(), { filename: 'content.js' });

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

setTimeout(async () => {
  const eng = window.__saicTest.AutomationEngine;
  const doc = window.document;

  const stopBtn = doc.querySelector('.saic-auto-stop');
  check('stop button rendered in panel', !!stopBtn);
  check('stop button hidden while idle', stopBtn && stopBtn.style.display === 'none', stopBtn && stopBtn.style.display);

  // Simulate running state without a real cycle: set state and refresh UI
  eng.state = 'running';
  eng.updateUI();
  const stopBtn2 = doc.querySelector('.saic-auto-stop');
  check('stop button visible while running', stopBtn2 && stopBtn2.style.display !== 'none', stopBtn2 && stopBtn2.style.display);

  // Clicking Stop must transition the engine to stopped
  stopBtn2.click();
  await new Promise(r => setTimeout(r, 50));
  check('engine state is stopped after click', eng.state === 'stopped', eng.state);
  const stopBtn3 = doc.querySelector('.saic-auto-stop');
  check('stop button hidden again after stop', stopBtn3 && stopBtn3.style.display === 'none', stopBtn3 && stopBtn3.style.display);
  const statusText = doc.querySelector('.saic-auto-status-text');
  check('status text shows stopped', /Stopped/i.test(statusText ? statusText.textContent : ''), statusText && statusText.textContent);

  console.log('\n== Results: ' + pass + ' passed, ' + fail + ' failed ==');
  process.exit(fail > 0 ? 1 : 0);
}, 150);
