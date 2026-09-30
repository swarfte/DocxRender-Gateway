'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');
const h = require('./helpers');

let ctx;
before(async () => { ctx = await h.startServer(); });
after(() => ctx.server.close());

const post = (form) =>
  fetch(ctx.url, { method: 'POST', headers: { Authorization: `Bearer ${h.TOKEN}` }, body: form });

async function renderOk(paragraphs, data) {
  const res = await post(h.buildForm({ data, template: h.buildDocx(paragraphs) }));
  assert.equal(res.status, 200, await res.clone().text());
  return { res, xml: h.documentXml(Buffer.from(await res.arrayBuffer())) };
}

test('replaces plain text and returns DOCX binary with spec headers', async () => {
  const { res, xml } = await renderOk(['Customer: {customer_name}'], { customer_name: 'University of Macau' });
  assert.equal(res.headers.get('content-type'), h.DOCX_MIME);
  assert.match(res.headers.get('content-disposition'), /rendered-output\.docx/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.ok(res.headers.get('x-request-id'));
  assert.match(xml, /Customer: University of Macau/);
});

test('supports nested object fields', async () => {
  const { xml } = await renderOk(['{customer.name} / {customer.address}'], {
    customer: { name: 'UM', address: 'Taipa' },
  });
  assert.match(xml, /UM \/ Taipa/);
});

test('renders loops', async () => {
  const { xml } = await renderOk(['{#products}', 'Product: {product_name}', '{/products}'], {
    products: [{ product_name: 'A' }, { product_name: 'B' }],
  });
  assert.match(xml, /Product: A/);
  assert.match(xml, /Product: B/);
});

test('boolean section shows on true and hides on false', async () => {
  const tpl = ['{#flag}', 'Table-Lite', '{/flag}'];
  assert.match((await renderOk(tpl, { flag: true })).xml, /Table-Lite/);
  assert.doesNotMatch((await renderOk(tpl, { flag: false })).xml, /Table-Lite/);
});

test('inserts PNG data URI image', async () => {
  const res = await post(h.buildForm({ data: { logo: h.PNG_DATA_URI }, template: h.buildDocx(['{%logo}']) }));
  assert.equal(res.status, 200, await res.clone().text());
  const zip = new PizZip(Buffer.from(await res.arrayBuffer()));
  assert.ok(Object.keys(zip.files).some((f) => f.startsWith('word/media/')));
  assert.match(zip.file('word/document.xml').asText(), /<w:drawing>/);
});

test('inserts JPEG data URI image', async () => {
  const res = await post(h.buildForm({ data: { logo: h.jpegDataUri(64, 32) }, template: h.buildDocx(['{%logo}']) }));
  assert.equal(res.status, 200, await res.clone().text());
  const zip = new PizZip(Buffer.from(await res.arrayBuffer()));
  assert.ok(Object.keys(zip.files).some((f) => f.startsWith('word/media/')));
  assert.deepEqual(extents(zip.file('word/document.xml').asText()), [[64, 32]]);
});

test('rejects non-http(s) image URL scheme with 422', async () => {
  const res = await post(h.buildForm({ data: { logo: 'ftp://example.com/a.png' }, template: h.buildDocx(['{%logo}']) }));
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error.code, 'TEMPLATE_RENDER_FAILED');
});

test('rejects unsupported image data URI (svg) with 415', async () => {
  const res = await post(
    h.buildForm({ data: { logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }, template: h.buildDocx(['{%logo}']) }),
  );
  assert.equal(res.status, 415);
});

test('malformed template tag returns 422 with error envelope and no stack', async () => {
  const res = await post(h.buildForm({ data: {}, template: h.buildDocx(['{#open} never closed']) }));
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.ok(body.request_id);
  assert.equal(body.error.code, 'TEMPLATE_RENDER_FAILED');
  assert.ok(!JSON.stringify(body).includes('node_modules'));
});

test('render timeout returns 504', async () => {
  const slow = await h.startServer({ renderTimeoutMs: 1 });
  try {
    const res = await fetch(slow.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${h.TOKEN}` },
      body: h.buildForm({ data: { a: 1 }, template: h.buildDocx(['{a}']) }),
    });
    assert.equal(res.status, 504);
    assert.equal((await res.json()).error.code, 'RENDER_TIMEOUT');
  } finally {
    slow.server.close();
  }
});

test('concurrency limit returns 429', async () => {
  const busy = await h.startServer({ maxConcurrentRenders: 1 });
  try {
    const send = () =>
      fetch(busy.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${h.TOKEN}` },
        body: h.buildForm({ data: { a: 1 }, template: h.buildDocx(['{a}']) }),
      });
    const statuses = (await Promise.all([send(), send(), send()])).map((r) => r.status);
    assert.ok(statuses.includes(200));
    assert.ok(statuses.includes(429), `got ${statuses}`);
  } finally {
    busy.server.close();
  }
});

// --- image URLs ---
const http = require('node:http');
const PNG_BYTES = Buffer.from(h.PNG_DATA_URI.split(',')[1], 'base64');

async function withImageServer(handler, run) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { await run(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}

const urlCfg = (over = {}) => ({
  imageUrl: { enabled: true, allowedHosts: [], allowedPorts: [80, 443], allowPrivate: true, maxBytes: 5242880, timeoutMs: 5000, ...over },
});

async function renderUrl(cfg, url) {
  const s = await h.startServer(cfg);
  try {
    return await fetch(s.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${h.TOKEN}` },
      body: h.buildForm({ data: { logo: url }, template: h.buildDocx(['{%logo}']) }),
    });
  } finally { s.server.close(); }
}

test('inserts image from http URL', async () => {
  await withImageServer((req, res) => { res.setHeader('Content-Type', 'image/png'); res.end(PNG_BYTES); }, async (base) => {
    const res = await renderUrl(urlCfg(), `${base}/logo.png`);
    assert.equal(res.status, 200, await res.clone().text());
    const zip = new PizZip(Buffer.from(await res.arrayBuffer()));
    assert.ok(Object.keys(zip.files).some((f) => f.startsWith('word/media/')));
  });
});

test('follows redirects to an image', async () => {
  await withImageServer((req, res) => {
    if (req.url === '/a') { res.writeHead(302, { Location: '/b.png' }); return res.end(); }
    res.end(PNG_BYTES);
  }, async (base) => {
    assert.equal((await renderUrl(urlCfg(), `${base}/a`)).status, 200);
  });
});

test('URL to loopback is blocked by default (SSRF guard)', async () => {
  await withImageServer((req, res) => res.end(PNG_BYTES), async (base) => {
    assert.equal((await renderUrl(urlCfg({ allowPrivate: false }), `${base}/x.png`)).status, 422);
  });
});

test('non-image content, 404 and oversize are rejected with 422', async () => {
  await withImageServer((req, res) => {
    if (req.url === '/404') { res.statusCode = 404; return res.end(); }
    if (req.url === '/big') return res.end(Buffer.concat([PNG_BYTES, Buffer.alloc(3000)]));
    res.end('<html>not an image</html>');
  }, async (base) => {
    assert.equal((await renderUrl(urlCfg(), `${base}/html`)).status, 422);
    assert.equal((await renderUrl(urlCfg(), `${base}/404`)).status, 422);
    assert.equal((await renderUrl(urlCfg({ maxBytes: 1000 }), `${base}/big`)).status, 422);
  });
});

test('URL images can be disabled and host-restricted', async () => {
  await withImageServer((req, res) => res.end(PNG_BYTES), async (base) => {
    assert.equal((await renderUrl(urlCfg({ enabled: false }), `${base}/x.png`)).status, 422);
    assert.equal((await renderUrl(urlCfg({ allowedHosts: ['example.com'] }), `${base}/x.png`)).status, 422);
  });
});

// --- image sizing ---
const extents = (xml) => [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].map((m) => [Number(m[1]) / 9525, Number(m[2]) / 9525]);

async function renderSized(paragraphs, data) {
  const res = await post(h.buildForm({ data, template: h.buildDocx(paragraphs) }));
  return { res, xml: res.status === 200 ? h.documentXml(Buffer.from(await res.arrayBuffer())) : null };
}

test('uses the image original size when no {size} key is given', async () => {
  const { res, xml } = await renderSized(['{%logo}'], { logo: h.pngDataUri(120, 45) });
  assert.equal(res.status, 200);
  assert.deepEqual(extents(xml), [[120, 45]]);
});

test('"<name>{size}" keys override the original size independently', async () => {
  const { res, xml } = await renderSized(['{%client_icon}', '{%client_image}', '{%other}'], {
    'client_icon{size}': '50x50',
    client_icon: h.pngDataUri(400, 400),
    client_image: h.pngDataUri(10, 10),
    'client_image{size}': '300X200',
    other: h.pngDataUri(77, 33),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(extents(xml), [[50, 50], [300, 200], [77, 33]]);
});

test('{size} is scoped per object inside loops', async () => {
  const { xml } = await renderSized(['{#items}', '{%pic}', '{/items}'], {
    items: [{ pic: h.pngDataUri(9, 9), 'pic{size}': '40x30' }, { pic: h.pngDataUri(20, 20) }],
  });
  assert.deepEqual(extents(xml), [[40, 30], [20, 20]]);
});

test('invalid {size} value -> 400', async () => {
  const { res } = await renderSized(['{%logo}'], { logo: h.pngDataUri(5, 5), 'logo{size}': 'big' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'INVALID_IMAGE_SIZE');
});

test('zero size -> 400', async () => {
  const { res } = await renderSized(['{%logo}'], { logo: h.pngDataUri(5, 5), 'logo{size}': '0x50' });
  assert.equal(res.status, 400);
});
