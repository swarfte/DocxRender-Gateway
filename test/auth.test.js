'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const h = require('./helpers');
const { resolveToken } = require('../src/token-manager');

let ctx;
before(async () => { ctx = await h.startServer(); });
after(() => ctx.server.close());

const form = () => h.buildForm({ data: { a: 1 }, template: h.buildDocx(['{a}']) });

test('missing Authorization header -> 401', async () => {
  const res = await fetch(ctx.url, { method: 'POST', body: form() });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, 'UNAUTHORIZED');
  assert.ok(body.request_id);
});

test('wrong token -> 401 without leaking the real token', async () => {
  const res = await fetch(ctx.url, { method: 'POST', headers: { Authorization: 'Bearer nope' }, body: form() });
  assert.equal(res.status, 401);
  assert.ok(!(await res.text()).includes(h.TOKEN));
});

test('non-Bearer scheme -> 401', async () => {
  const res = await fetch(ctx.url, { method: 'POST', headers: { Authorization: `Basic ${h.TOKEN}` }, body: form() });
  assert.equal(res.status, 401);
});

test('token manager: env > file > generate, and generated token persists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-'));
  const tokenFile = path.join(dir, 'secrets', 'api-token');
  try {
    const envToken = 'e'.repeat(40);
    assert.deepEqual(
      [resolveToken({ env: { API_TOKEN: envToken }, tokenFile }).token, fs.existsSync(tokenFile)],
      [envToken, false],
    );

    const first = resolveToken({ env: {}, tokenFile });
    assert.equal(first.generated, true);
    assert.ok(first.token.length >= 64);

    const second = resolveToken({ env: {}, tokenFile });
    assert.equal(second.generated, false);
    assert.equal(second.token, first.token);
    assert.throws(() => resolveToken({ env: { API_TOKEN: 'short' }, tokenFile }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
