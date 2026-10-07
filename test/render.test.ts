'use strict';

import { test } from 'vitest';
import assert from 'node:assert/strict';
import http from 'node:http';
import PizZip from 'pizzip';
import { app, buildDocx, buildForm, documentXml, DOCX_MIME, jpegDataUri, makeEnv, PNG_DATA_URI, pngDataUri, post, TOKEN } from './helpers';

const env = makeEnv();

const postAs = (e: ReturnType<typeof makeEnv>, form: FormData) => post(e, form);

async function renderOk(paragraphs: string[], data: unknown) {
  const res = await post(env, buildForm({ data, template: buildDocx(paragraphs) }));
  assert.equal(res.status, 200, await res.clone().text());
  return { res, xml: documentXml(new Uint8Array(await res.arrayBuffer())) };
}

test('replaces plain text and returns DOCX binary with spec headers', async () => {
  const { res, xml } = await renderOk(['Customer: {customer_name}'], { customer_name: 'University of Macau' });
  assert.equal(res.headers.get('content-type'), DOCX_MIME);
  assert.match(res.headers.get('content-disposition')!, /filename="template_rendered\.docx"/);
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

test('derives the output filename from the uploaded template name', async () => {
  const res = await post(env, buildForm({ data: { a: 1 }, template: buildDocx(['{a}']) }));
  assert.equal(res.status, 200, await res.clone().text());
  const disposition = res.headers.get('content-disposition')!;
  assert.match(disposition, /filename="template_rendered\.docx"/);
  assert.match(disposition, /filename\*=UTF-8''template_rendered\.docx/);
});

test('carries non-ASCII template names in filename*', async () => {
  const form = new FormData();
  form.append('data', new Blob(['{"a":1}'], { type: 'application/json' }), 'data.json');
  form.append('templater', new Blob([buildDocx(['{a}'])], { type: DOCX_MIME }), '報價單.docx');
  const res = await post(env, form);
  assert.equal(res.status, 200, await res.clone().text());
  const disposition = res.headers.get('content-disposition')!;
  assert.match(disposition, /filename\*=UTF-8''%E5%A0%B1%E5%83%B9%E5%96%AE_rendered\.docx/);
  // The quoted fallback must stay pure ASCII.
  const fallback = disposition.match(/filename="([^"]+)"/)![1]!;
  assert.ok(/^[\x20-\x7e]+$/.test(fallback), fallback);
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
  const res = await post(env, buildForm({ data: { logo: PNG_DATA_URI }, template: buildDocx(['{%logo}']) }));
  assert.equal(res.status, 200, await res.clone().text());
  const zip = new PizZip(new Uint8Array(await res.arrayBuffer()));
  assert.ok(Object.keys(zip.files).some((f) => String(f).startsWith('word/media/')));
  assert.match(zip.file('word/document.xml')!.asText(), /<w:drawing>/);
});

test('inserts JPEG data URI image', async () => {
  const res = await post(env, buildForm({ data: { logo: jpegDataUri(64, 32) }, template: buildDocx(['{%logo}']) }));
  assert.equal(res.status, 200, await res.clone().text());
  const zip = new PizZip(new Uint8Array(await res.arrayBuffer()));
  assert.ok(Object.keys(zip.files).some((f) => String(f).startsWith('word/media/')));
  assert.deepEqual(extents(zip.file('word/document.xml')!.asText()), [[64, 32]]);
});

test('rejects non-http(s) image URL scheme with 422', async () => {
  const res = await post(
    env,
    buildForm({ data: { logo: 'ftp://example.com/a.png' }, template: buildDocx(['{%logo}']) }),
  );
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error.code, 'TEMPLATE_RENDER_FAILED');
});

test('rejects unsupported image data URI (svg) with 415', async () => {
  const res = await post(
    env,
    buildForm({ data: { logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }, template: buildDocx(['{%logo}']) }),
  );
  assert.equal(res.status, 415);
});

test('malformed template tag returns 422 with error envelope and no stack', async () => {
  const res = await post(env, buildForm({ data: {}, template: buildDocx(['{#open} never closed']) }));
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.ok(body.request_id);
  assert.equal(body.error.code, 'TEMPLATE_RENDER_FAILED');
  assert.ok(!JSON.stringify(body).includes('node_modules'));
});

// --- render timeout ---
// Inline rendering (no worker threads) runs on microtasks, so a wall-clock
// deadline can only preempt renders that yield to the event loop — an image
// fetch over HTTP is the realistic case, and what this test exercises.
const PNG_BYTES = Buffer.from(PNG_DATA_URI.split(',')[1]!, 'base64');

async function withImageServer(handler: http.RequestListener, run: (base: string) => Promise<void>) {
  const srv = http.createServer(handler);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  try {
    await run(`http://127.0.0.1:${(srv.address() as http.AddressInfo).port}`);
  } finally {
    srv.close();
  }
}

test('render timeout returns 504', async () => {
  await withImageServer(
    (req, res) => {
      setTimeout(() => res.end(PNG_BYTES), 200);
    },
    async (base) => {
      const slow = makeEnv({ RENDER_TIMEOUT_MS: '10', IMAGE_URL_ALLOW_PRIVATE: 'true' });
      const res = await postAs(
        slow,
        buildForm({ data: { logo: `${base}/slow.png` }, template: buildDocx(['{%logo}']) }),
      );
      assert.equal(res.status, 504);
      assert.equal((await res.json()).error.code, 'RENDER_TIMEOUT');
    },
  );
});

test('concurrency limit returns 429', async () => {
  const busy = makeEnv({ MAX_CONCURRENT_RENDERS: '1' });
  const send = () => postAs(busy, buildForm({ data: { a: 1 }, template: buildDocx(['{a}']) }));
  const statuses = (await Promise.all([send(), send(), send()])).map((r) => r.status);
  assert.ok(statuses.includes(200));
  assert.ok(statuses.includes(429), `got ${statuses}`);
});

// --- image URLs ---
const urlEnv = (over: Record<string, string> = {}) =>
  makeEnv({ IMAGE_URL_ALLOW_PRIVATE: 'true', ...over });

async function renderUrl(env2: ReturnType<typeof makeEnv>, url: string) {
  return postAs(
    env2,
    buildForm({ data: { logo: url }, template: buildDocx(['{%logo}']) }),
  );
}

test('inserts image from http URL', async () => {
  await withImageServer(
    (req, res) => {
      res.setHeader('Content-Type', 'image/png');
      res.end(PNG_BYTES);
    },
    async (base) => {
      const res = await renderUrl(urlEnv(), `${base}/logo.png`);
      assert.equal(res.status, 200, await res.clone().text());
      const zip = new PizZip(new Uint8Array(await res.arrayBuffer()));
      assert.ok(Object.keys(zip.files).some((f) => String(f).startsWith('word/media/')));
    },
  );
});

// Stand-in for the Cloudflare Images binding: "converts" any input to the 1x1 PNG.
const fakeImages = {
  input: (_stream: ReadableStream<Uint8Array>) => ({
    output: async (_o: { format: 'image/png' }) => ({ response: () => new Response(PNG_BYTES) }),
  }),
};

test('converts a WebP URL image (e.g. Brandfetch) to PNG via the IMAGES binding', async () => {
  const webp = Buffer.from('RIFF$   WEBPVP8 ', 'binary');
  await withImageServer(
    (req, res) => {
      res.setHeader('Content-Type', 'image/webp');
      res.end(webp);
    },
    async (base) => {
      const res = await renderUrl({ ...urlEnv(), IMAGES: fakeImages }, `${base}/wynnmacau.com?c=abc`);
      assert.equal(res.status, 200, await res.clone().text());
      const zip = new PizZip(new Uint8Array(await res.arrayBuffer()));
      assert.ok(Object.keys(zip.files).some((f) => String(f).startsWith('word/media/')));
    },
  );
});

test('non-PNG/JPEG URL image without IMAGES binding is rejected with 422', async () => {
  await withImageServer(
    (req, res) => res.end(Buffer.from('RIFF$   WEBPVP8 ', 'binary')),
    async (base) => {
      assert.equal((await renderUrl(urlEnv(), `${base}/x`)).status, 422);
    },
  );
});

test('follows redirects to an image', async () => {
  await withImageServer(
    (req, res) => {
      if (req.url === '/a') {
        res.writeHead(302, { Location: '/b.png' });
        return res.end();
      }
      res.end(PNG_BYTES);
    },
    async (base) => {
      assert.equal((await renderUrl(urlEnv(), `${base}/a`)).status, 200);
    },
  );
});

test('URL to loopback is blocked by default (SSRF guard)', async () => {
  await withImageServer(
    (req, res) => res.end(PNG_BYTES),
    async (base) => {
      assert.equal((await renderUrl(urlEnv({ IMAGE_URL_ALLOW_PRIVATE: 'false' }), `${base}/x.png`)).status, 422);
    },
  );
});

test('non-image content, 404 and oversize are rejected with 422', async () => {
  await withImageServer(
    (req, res) => {
      if (req.url === '/404') {
        res.statusCode = 404;
        return res.end();
      }
      if (req.url === '/big') return res.end(Buffer.concat([PNG_BYTES, Buffer.alloc(3000)]));
      res.end('<html>not an image</html>');
    },
    async (base) => {
      assert.equal((await renderUrl(urlEnv(), `${base}/html`)).status, 422);
      assert.equal((await renderUrl(urlEnv(), `${base}/404`)).status, 422);
      assert.equal((await renderUrl(urlEnv({ MAX_IMAGE_BYTES: '1000' }), `${base}/big`)).status, 422);
    },
  );
});

test('URL images can be disabled and host-restricted', async () => {
  await withImageServer(
    (req, res) => res.end(PNG_BYTES),
    async (base) => {
      assert.equal((await renderUrl(urlEnv({ IMAGE_URL_ENABLED: 'false' }), `${base}/x.png`)).status, 422);
      assert.equal(
        (await renderUrl(urlEnv({ IMAGE_URL_ALLOWED_HOSTS: 'example.com' }), `${base}/x.png`)).status,
        422,
      );
    },
  );
});

// --- image sizing ---
const extents = (xml: string) =>
  [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].map((m) => [Number(m[1]) / 9525, Number(m[2]) / 9525]);

async function renderSized(paragraphs: string[], data: unknown) {
  const res = await post(env, buildForm({ data, template: buildDocx(paragraphs) }));
  return { res, xml: res.status === 200 ? documentXml(new Uint8Array(await res.arrayBuffer())) : null };
}

test('uses the image original size when no {size} key is given', async () => {
  const { res, xml } = await renderSized(['{%logo}'], { logo: pngDataUri(120, 45) });
  assert.equal(res.status, 200);
  assert.deepEqual(extents(xml!), [[120, 45]]);
});

test('"<name>{size}" keys override the original size independently', async () => {
  const { res, xml } = await renderSized(['{%client_icon}', '{%client_image}', '{%other}'], {
    'client_icon{size}': '50x50',
    client_icon: pngDataUri(400, 400),
    client_image: pngDataUri(10, 10),
    'client_image{size}': '300X200',
    other: pngDataUri(77, 33),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(extents(xml!), [[50, 50], [300, 200], [77, 33]]);
});

test('{size} is scoped per object inside loops', async () => {
  const { xml } = await renderSized(['{#items}', '{%pic}', '{/items}'], {
    items: [{ pic: pngDataUri(9, 9), 'pic{size}': '40x30' }, { pic: pngDataUri(20, 20) }],
  });
  assert.deepEqual(extents(xml!), [[40, 30], [20, 20]]);
});

test('invalid {size} value -> 400', async () => {
  const { res } = await renderSized(['{%logo}'], { logo: pngDataUri(5, 5), 'logo{size}': 'big' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'INVALID_IMAGE_SIZE');
});

test('zero size -> 400', async () => {
  const { res } = await renderSized(['{%logo}'], { logo: pngDataUri(5, 5), 'logo{size}': '0x50' });
  assert.equal(res.status, 400);
});
