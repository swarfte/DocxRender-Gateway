'use strict';

const PizZip = require('pizzip');
const { createApp } = require('../src/app');

const TOKEN = 'test-token-test-token-test-token-test-token';

// 1x1 transparent PNG
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_DATA_URI = `data:image/png;base64,${PNG_BASE64}`;

// Solid-colour PNG of the given pixel size (valid, decodable).
function pngDataUri(width, height) {
  const zlib = require('node:zlib');
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), body])));
    return Buffer.concat([len, Buffer.from(type), body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

// JPEG with a valid SOI + SOF0 header of the given size (enough for size detection; not a viewable image).
function jpegDataUri(width, height) {
  const sof = Buffer.from([0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]);
  const app0 = Buffer.from([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function paragraph(text) {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function buildDocx(paragraphs) {
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<w:body>${paragraphs.map(paragraph).join('')}</w:body></w:document>`,
  );
  return zip.generate({ type: 'nodebuffer' });
}

async function startServer(overrides = {}) {
  const config = {
    nodeEnv: 'test',
    maxTemplateBytes: 26214400,
    maxDataBytes: 10485760,
    maxTotalBytes: 36700160,
    renderTimeoutMs: 20000,
    maxConcurrentRenders: 2,
    imageUrl: { enabled: true, allowedHosts: [], allowedPorts: [80, 443], allowPrivate: false, maxBytes: 5242880, timeoutMs: 5000 },
    ...overrides,
  };
  const app = createApp({ token: TOKEN, config });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return { server, url: `http://127.0.0.1:${server.address().port}/templater/render` };
}

function buildForm({ data, template, dataName = 'data', templateName = 'templater', extra } = {}) {
  const form = new FormData();
  if (data !== undefined) {
    const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
    form.append(dataName, new Blob([body], { type: 'application/json' }), 'data.json');
  }
  if (template !== undefined) {
    form.append(templateName, new Blob([template], { type: DOCX_MIME }), 'template.docx');
  }
  if (extra) form.append('extra', new Blob(['x']), 'extra.txt');
  return form;
}

function documentXml(docxBuffer) {
  return new PizZip(docxBuffer).file('word/document.xml').asText();
}

module.exports = { pngDataUri, jpegDataUri, TOKEN, PNG_DATA_URI, jpegDataUri, DOCX_MIME, buildDocx, startServer, buildForm, documentXml };
