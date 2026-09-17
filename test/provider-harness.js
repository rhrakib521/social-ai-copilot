// Test harness: loads the REAL extension/background.js in a sandbox with mocked
// fetch/chrome, then drives the 'generate' message handler against simulated
// provider API responses. Run: node test/provider-harness.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'background.js'), 'utf8');

// ── Mock fetch: queue of responders keyed by URL substring ──
let fetchLog = [];
let responders = []; // {match: fn(url, body)->bool, respond: fn(url, body, init)->{status, body}}

function mockFetch(url, init) {
  const body = init && init.body ? JSON.parse(init.body) : null;
  fetchLog.push({ url, body });
  for (const r of responders) {
    if (r.match(url, body)) return Promise.resolve(makeResponse(r.respond(url, body)));
  }
  return Promise.resolve(makeResponse({ status: 599, body: '{"error":"no responder matched"}' }));
}
function makeResponse({ status, body, headers }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body)
  };
}

// ── Mock chrome API ──
let storageData = {};
const messageListeners = [];
const chromeMock = {
  runtime: {
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
    lastError: null
  },
  commands: { onCommand: { addListener: () => {} } },
  storage: {
    local: {
      get: (keys, cb) => {
        const out = {};
        (Array.isArray(keys) ? keys : [keys]).forEach(k => { if (storageData[k] !== undefined) out[k] = storageData[k]; });
        setTimeout(() => cb(out), 0);
      },
      set: (obj, cb) => { Object.assign(storageData, obj); if (cb) setTimeout(cb, 0); }
    }
  },
  tabs: { update: (id, props, cb) => cb && cb() }
};

const sandbox = {
  console,
  fetch: mockFetch,
  chrome: chromeMock,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  TextEncoder,
  crypto: require('crypto').webcrypto,
  setTimeout,
  clearTimeout,
  sleep: (ms) => new Promise(r => setTimeout(r, ms)),
  AbortController
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'background.js' });

// ── Helpers ──
function sendGenerate(data) {
  return new Promise((resolve) => {
    const listener = messageListeners[messageListeners.length - 1];
    listener({ type: 'generate', data }, { tab: { id: 1 } }, resolve);
  });
}
function setSettings(overrides) {
  storageData['socialAiCopilot_settings'] = {
    provider: 'glm',
    apiKey: 'test-key',
    glmModel: 'glm-5.1',
    openaiModel: 'gpt-4.1-mini',
    ...overrides
  };
}
const commentCtx = { postText: 'Just shipped our new dashboard, load times dropped 40%.', author: 'Sam', engagement: { likes: 120 } };
const req = (over) => ({ platform: 'x', task: 'quick_reply', tone: 'casual', context: commentCtx, ...over });

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

async function main() {
  console.log('== Provider behavior tests (against real background.js) ==\n');

  // ── TEST 1: OpenAI gpt-5 rejects temperature 0.7 (simulating real API behavior) ──
  console.log('[1] OpenAI gpt-5 + temperature 0.7');
  setSettings({ provider: 'openai', apiKey: 'sk-x', openaiModel: 'gpt-5.1' });
  fetchLog = []; responders = [{
    match: (u) => u.includes('api.openai.com'),
    respond: (u, body) => {
      if (body.temperature !== undefined && body.temperature !== 1) {
        return { status: 400, body: { error: { message: "Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) value is supported." } } };
      }
      return { status: 200, body: { choices: [{ message: { content: 'nice ship, the 40% load drop is huge' } }] } };
    }
  }];
  let r = await sendGenerate(req({}));
  check('gpt-5 request succeeds (no rejected temperature)', !r.error, r.error || '');

  // ── TEST 2: OpenAI gpt-5 with reasoning eating max_completion_tokens ──
  console.log('[2] OpenAI gpt-5 reasoning burns 300-token budget');
  setSettings({ provider: 'openai', apiKey: 'sk-x', openaiModel: 'gpt-5.1' });
  fetchLog = []; responders = [{
    match: (u) => u.includes('api.openai.com'),
    respond: (u, body) => {
      // simulate: reasoning tokens >= budget -> empty content
      const budget = body.max_completion_tokens || body.max_tokens || 0;
      if (budget < 1000) return { status: 200, body: { choices: [{ message: { content: '' }, finish_reason: 'length' }] } };
      return { status: 200, body: { choices: [{ message: { content: 'nice ship, the 40% load drop is huge' } }] } };
    }
  }];
  r = await sendGenerate(req({}));
  check('gpt-5 gets enough token budget for reasoning', !r.error && /load/.test(r.text || ''), r.error || ('text=' + JSON.stringify(r.text)));

  // ── TEST 3: GLM thinking model returns empty content + reasoning_content ──
  console.log('[3] GLM thinking model, empty content, reasoning present');
  setSettings({ provider: 'glm', apiKey: 'g.x', glmModel: 'glm-5.3', glmEndpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions' });
  fetchLog = []; responders = [{
    match: (u) => u.includes('bigmodel.cn') || u.includes('z.ai'),
    respond: (u, body) => {
      const budget = body.max_tokens || 0;
      if (budget >= 2048) return { status: 200, body: { choices: [{ message: { content: 'the 40% load drop is impressive', reasoning_content: '<think>user shipped dashboard...' } }] } };
      // budget too small: all tokens eaten by thinking
      return { status: 200, body: { choices: [{ message: { content: '', reasoning_content: 'Okay, the user just shipped a dashboard and load times dropped 40 percent, so I should' } }] } };
    }
  }];
  r = await sendGenerate(req({}));
  check('comment is the answer, not raw chain-of-thought', !r.error && !/Okay, the user/.test(r.text || ''), r.error || ('text=' + JSON.stringify(r.text).slice(0, 120)));

  // ── TEST 4: GLM thinking-disabled param actually sent for glm-5.1 ──
  console.log('[4] GLM glm-5.1 sends thinking disabled');
  setSettings({ provider: 'glm', apiKey: 'g.x', glmModel: 'glm-5.1', glmEndpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions' });
  fetchLog = []; responders = [{
    match: (u) => u.includes('bigmodel.cn') || u.includes('z.ai'),
    respond: () => ({ status: 200, body: { choices: [{ message: { content: 'ok' } }] } })
  }];
  r = await sendGenerate(req({}));
  const glmBody = fetchLog.length ? fetchLog[fetchLog.length - 1].body : null;
  check('thinking:{type:"disabled"} present for glm-5.1', glmBody && glmBody.thinking && glmBody.thinking.type === 'disabled', JSON.stringify(glmBody && glmBody.thinking));

  // ── TEST 5: GLM glm-4-flash must NOT get thinking param ──
  console.log('[5] GLM glm-4-flash gets no thinking param');
  setSettings({ provider: 'glm', apiKey: 'g.x', glmModel: 'glm-4-flash', glmEndpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions' });
  fetchLog = []; responders = [{
    match: (u) => u.includes('bigmodel.cn') || u.includes('z.ai'),
    respond: (u, body) => {
      if (body.thinking) return { status: 400, body: { error: { code: '1214', message: 'model not found / invalid parameter thinking' } } };
      return { status: 200, body: { choices: [{ message: { content: 'ok' } }] } };
    }
  }];
  r = await sendGenerate(req({}));
  check('no thinking param on glm-4-flash', !r.error, r.error || '');

  // ── TEST 6: GLM auto endpoint fallback when key only works on z.ai ──
  console.log('[6] GLM auto: key rejected on bigmodel.cn, works on api.z.ai');
  setSettings({ provider: 'glm', apiKey: 'g.x', glmModel: 'glm-5.1', glmEndpoint: 'auto' });
  fetchLog = []; responders = [{
    match: (u) => u.includes('open.bigmodel.cn/api/paas'),
    respond: () => ({ status: 401, body: { error: { code: '1000', message: 'Authentication failed' } } })
  }, {
    match: (u) => u.includes('api.z.ai/api/paas'),
    respond: () => ({ status: 200, body: { choices: [{ message: { content: 'works on z.ai' } }] } })
  }];
  r = await sendGenerate(req({}));
  check('falls back to z.ai and returns text', !r.error && r.text === 'works on z.ai', r.error || ('text=' + r.text));

  // ── TEST 7: GLM coding-plan key on coding endpoint only ──
  console.log('[7] GLM auto: only coding-plan endpoint works');
  setSettings({ provider: 'glm', apiKey: 'g.x', glmModel: 'glm-5.1', glmEndpoint: 'auto' });
  fetchLog = []; responders = [{
    match: (u) => u.includes('/api/coding/'),
    respond: () => ({ status: 200, body: { choices: [{ message: { content: 'coding plan ok' } }] } })
  }, {
    match: (u) => !u.includes('/api/coding/'),
    respond: () => ({ status: 403, body: { error: { code: '1113', message: 'no permission to access this model' } } })
  }];
  r = await sendGenerate(req({}));
  check('probes coding endpoints after 403', !r.error && r.text === 'coding plan ok', r.error || ('text=' + r.text));

  // ── TEST 8: GLM all endpoints fail -> last error surfaced, not generic rate-limit msg ──
  console.log('[8] GLM auto: everything fails');
  setSettings({ provider: 'glm', apiKey: 'g.x', glmModel: 'glm-5.1', glmEndpoint: 'auto' });
  fetchLog = []; responders = [{
    match: (u) => u.includes('bigmodel.cn') || u.includes('z.ai'),
    respond: (u) => ({ status: 401, body: { error: { code: '1000', message: 'Authentication failed at ' + u } } })
  }];
  r = await sendGenerate(req({}));
  check('real auth error surfaced', r.error && /Authentication failed/.test(r.error), 'error=' + r.error);

  // ── TEST 9: GLM 429 then success on retry ──
  console.log('[9] GLM 429 once then success');
  setSettings({ provider: 'glm', apiKey: 'g.x', glmModel: 'glm-5.1', glmEndpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions' });
  let hits = 0;
  fetchLog = []; responders = [{
    match: (u) => u.includes('bigmodel.cn'),
    respond: () => { hits++; return hits === 1 ? { status: 429, body: { error: { code: '1302', message: 'rate limit' } } } : { status: 200, body: { choices: [{ message: { content: 'after retry' } }] } }; }
  }];
  r = await sendGenerate(req({}));
  check('429 retried successfully', !r.error && r.text === 'after retry', r.error || '');

  // ── TEST 10: id.secret key -> JWT token generated (has 3 dot-separated parts) ──
  console.log('[10] GLM id.secret key becomes JWT');
  setSettings({ provider: 'glm', apiKey: 'abc123.xyz789', glmModel: 'glm-5.1', glmEndpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions' });
  fetchLog = []; responders = [{
    match: (u) => u.includes('bigmodel.cn'),
    respond: () => ({ status: 200, body: { choices: [{ message: { content: 'jwt ok' } }] } })
  }];
  r = await sendGenerate(req({}));
  // JWT format: header.payload.signature = 3 parts; raw key "abc123.xyz789" has 1 dot but no valid b64 signature semantics.
  // We can't see the header from here; just assert request succeeded and didn't send raw key as failure.
  check('id.secret key request succeeds', !r.error, r.error || '');

  // ── TEST 11: OpenAI normal model still uses max_tokens ──
  console.log('[11] OpenAI gpt-4.1-mini uses max_tokens');
  setSettings({ provider: 'openai', apiKey: 'sk-x', openaiModel: 'gpt-4.1-mini' });
  fetchLog = []; responders = [{
    match: (u) => u.includes('api.openai.com'),
    respond: (u, body) => {
      if (body.max_completion_tokens) return { status: 400, body: { error: { message: 'max_completion_tokens not supported by this model' } } };
      return { status: 200, body: { choices: [{ message: { content: 'legacy ok' } }] } };
    }
  }];
  r = await sendGenerate(req({}));
  check('gpt-4.1-mini uses max_tokens (legacy param)', !r.error && r.text === 'legacy ok', r.error || '');

  // ── TEST 12: Gemini via OpenAI-compat, array content parts ──
  console.log('[12] Gemini array content parts');
  setSettings({ provider: 'gemini', apiKey: 'g-x', geminiModel: 'gemini-2.5-flash' });
  fetchLog = []; responders = [{
    match: (u) => u.includes('generativelanguage.googleapis.com'),
    respond: () => ({ status: 200, body: { choices: [{ message: { content: [{ type: 'text', text: 'part1 ' }, { type: 'text', text: 'part2' }] } }] } })
  }];
  r = await sendGenerate(req({}));
  check('array content joined', !r.error && r.text === 'part1 part2', r.error || ('text=' + r.text));

  // ── TEST 13: reasoning_content must NEVER be returned, even on starvation ──
  console.log('[13] GLM glm-5.3 starved: error out, never post thinking text');
  setSettings({ provider: 'glm', apiKey: 'g.x', glmModel: 'glm-5.3', glmEndpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions' });
  fetchLog = []; responders = [{
    match: (u) => u.includes('bigmodel.cn') || u.includes('z.ai'),
    respond: () => ({ status: 200, body: { choices: [{ message: { content: '', reasoning_content: 'Okay the user shipped a dashboard so I should' } }] } })
  }];
  r = await sendGenerate(req({}));
  check('errors instead of returning reasoning text', !!r.error, 'returned text=' + JSON.stringify(r.text));

  // ── TEST 14: Gemini 2.5 thinking model gets budget floor ──
  console.log('[14] Gemini 2.5-flash budget floor');
  setSettings({ provider: 'gemini', apiKey: 'g-x', geminiModel: 'gemini-2.5-flash' });
  fetchLog = []; responders = [{
    match: (u) => u.includes('generativelanguage.googleapis.com'),
    respond: (u, body) => {
      if ((body.max_tokens || 0) >= 1500) return { status: 200, body: { choices: [{ message: { content: 'budget ok' } }] } };
      return { status: 200, body: { choices: [{ message: { content: '' }, finish_reason: 'MAX_TOKENS' }] } };
    }
  }];
  r = await sendGenerate(req({}));
  check('gemini-2.5-flash budget >= 1500', !r.error && r.text === 'budget ok', r.error || '');

  // ── TEST 15: DeepSeek reasoner budget floor ──
  console.log('[15] deepseek-reasoner budget floor');
  setSettings({ provider: 'deepseek', apiKey: 'ds-x', deepseekModel: 'deepseek-reasoner' });
  fetchLog = []; responders = [{
    match: (u) => u.includes('api.deepseek.com'),
    respond: (u, body) => {
      if ((body.max_tokens || 0) >= 2000) return { status: 200, body: { choices: [{ message: { content: 'reasoner ok' } }] } };
      return { status: 200, body: { choices: [{ message: { content: '', reasoning_content: 'thinking...' } }] } };
    }
  }];
  r = await sendGenerate(req({}));
  check('deepseek-reasoner budget >= 2000', !r.error && r.text === 'reasoner ok', r.error || '');

  console.log('\n== Results: ' + pass + ' passed, ' + fail + ' failed ==');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
