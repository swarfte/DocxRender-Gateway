'use strict';

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { app, buildDocx, buildForm, makeEnv, TOKEN } from './helpers';

const env = makeEnv();
const form = () => buildForm({ data: { a: 1 }, template: buildDocx(['{a}']) });

test('missing Authorization header -> 401', async () => {
  const res = await app.request('http://localhost/templater/render', { method: 'POST', body: form() }, env);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, 'UNAUTHORIZED');
  assert.ok(body.request_id);
  assert.ok(res.headers.get('x-request-id'));
});

test('wrong token -> 401 without leaking the real token', async () => {
  const res = await app.request(
    'http://localhost/templater/render',
    { method: 'POST', headers: { Authorization: 'Bearer nope' }, body: form() },
    env,
  );
  assert.equal(res.status, 401);
  assert.ok(!(await res.text()).includes(TOKEN));
});

test('non-Bearer scheme -> 401', async () => {
  const res = await app.request(
    'http://localhost/templater/render',
    { method: 'POST', headers: { Authorization: `Basic ${TOKEN}` }, body: form() },
    env,
  );
  assert.equal(res.status, 401);
});
