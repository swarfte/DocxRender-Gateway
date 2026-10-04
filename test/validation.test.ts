'use strict';

import { test } from 'vitest';
import assert from 'node:assert/strict';
import PizZip from 'pizzip';
import { app, buildDocx, buildForm, makeEnv, post, TOKEN } from './helpers';

const env = makeEnv({ MAX_DATA_BYTES: '1000', MAX_TEMPLATE_BYTES: '200000' });
const tpl = () => buildDocx(['{a}']);

async function expectError(res: Response, status: number, code: string): Promise<void> {
  assert.equal(res.status, status);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, code);
  assert.ok(body.request_id);
  assert.equal(res.headers.get('cache-control'), 'no-store');
}

test('non-multipart content type -> 400', async () => {
  await expectError(
    await post(env, '{}' as unknown as FormData, { 'Content-Type': 'application/json' }),
    400,
    'INVALID_CONTENT_TYPE',
  );
});

test('missing data -> 400', async () => {
  await expectError(await post(env, buildForm({ template: tpl() })), 400, 'MISSING_DATA');
});

test('missing templater -> 400', async () => {
  await expectError(await post(env, buildForm({ data: {} })), 400, 'MISSING_TEMPLATER');
});

test('extra upload field -> 400', async () => {
  await expectError(await post(env, buildForm({ data: {}, template: tpl(), extra: true })), 400, 'INVALID_UPLOAD');
});

test('duplicate upload field -> 400', async () => {
  const form = buildForm({ data: {}, template: tpl() });
  form.append('data', new Blob(['{}'], { type: 'application/json' }), 'data2.json');
  await expectError(await post(env, form), 400, 'INVALID_UPLOAD');
});

test('text field in upload -> 400', async () => {
  const form = buildForm({ data: {}, template: tpl() });
  form.append('note', 'hello');
  await expectError(await post(env, form), 400, 'INVALID_UPLOAD');
});

test('oversized total request -> 413', async () => {
  // app.request bodies carry no Content-Length, so state it like a real client would.
  const capped = makeEnv({ MAX_TOTAL_BYTES: '10' });
  await expectError(
    await post(capped, buildForm({ data: { a: 1 }, template: tpl() }), { 'Content-Length': '100' }),
    413,
    'PAYLOAD_TOO_LARGE',
  );
});

test('invalid JSON -> 400', async () => {
  await expectError(await post(env, buildForm({ data: '{not json', template: tpl() })), 400, 'INVALID_JSON');
});

test('JSON scalar root -> 400', async () => {
  await expectError(await post(env, buildForm({ data: '"text"', template: tpl() })), 400, 'INVALID_JSON_ROOT');
});

test('template that is not a DOCX -> 415', async () => {
  await expectError(
    await post(env, buildForm({ data: {}, template: new TextEncoder().encode('hello') })),
    415,
    'UNSUPPORTED_FILE_TYPE',
  );
});

test('ZIP without word/document.xml -> 415', async () => {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<Types/>');
  const buf = zip.generate({ type: 'uint8array' });
  await expectError(await post(env, buildForm({ data: {}, template: buf })), 415, 'UNSUPPORTED_FILE_TYPE');
});

test('oversized data file -> 413', async () => {
  const big = JSON.stringify({ pad: 'x'.repeat(2000) });
  await expectError(await post(env, buildForm({ data: big, template: tpl() })), 413, 'PAYLOAD_TOO_LARGE');
});

test('unknown route -> 404 JSON', async () => {
  const res = await app.request('http://localhost/nope', { headers: { Authorization: `Bearer ${TOKEN}` } }, env);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.ok(body.request_id);
});
