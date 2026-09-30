'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');
const h = require('./helpers');

let ctx;
before(async () => { ctx = await h.startServer({ maxDataBytes: 1000, maxTemplateBytes: 200000 }); });
after(() => ctx.server.close());

const post = (body, headers = {}) =>
  fetch(ctx.url, { method: 'POST', headers: { Authorization: `Bearer ${h.TOKEN}`, ...headers }, body });
const tpl = () => h.buildDocx(['{a}']);

async function expectError(res, status, code) {
  assert.equal(res.status, status);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, code);
  assert.ok(body.request_id);
}

test('non-multipart content type -> 400', async () => {
  await expectError(await post('{}', { 'Content-Type': 'application/json' }), 400, 'INVALID_CONTENT_TYPE');
});

test('missing data -> 400', async () => {
  await expectError(await post(h.buildForm({ template: tpl() })), 400, 'MISSING_DATA');
});

test('missing templater -> 400', async () => {
  await expectError(await post(h.buildForm({ data: {} })), 400, 'MISSING_TEMPLATER');
});

test('extra upload field -> 400', async () => {
  await expectError(await post(h.buildForm({ data: {}, template: tpl(), extra: true })), 400, 'INVALID_UPLOAD');
});

test('invalid JSON -> 400', async () => {
  await expectError(await post(h.buildForm({ data: '{not json', template: tpl() })), 400, 'INVALID_JSON');
});

test('JSON scalar root -> 400', async () => {
  await expectError(await post(h.buildForm({ data: '"text"', template: tpl() })), 400, 'INVALID_JSON_ROOT');
});

test('template that is not a DOCX -> 415', async () => {
  await expectError(await post(h.buildForm({ data: {}, template: Buffer.from('hello') })), 415, 'UNSUPPORTED_FILE_TYPE');
});

test('ZIP without word/document.xml -> 415', async () => {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<Types/>');
  const buf = zip.generate({ type: 'nodebuffer' });
  await expectError(await post(h.buildForm({ data: {}, template: buf })), 415, 'UNSUPPORTED_FILE_TYPE');
});

test('oversized data file -> 413', async () => {
  const big = JSON.stringify({ pad: 'x'.repeat(2000) });
  await expectError(await post(h.buildForm({ data: big, template: tpl() })), 413, 'PAYLOAD_TOO_LARGE');
});

test('unknown route -> 404 JSON', async () => {
  const res = await fetch(ctx.url.replace('/templater/render', '/nope'), { headers: { Authorization: `Bearer ${h.TOKEN}` } });
  assert.equal(res.status, 404);
});
