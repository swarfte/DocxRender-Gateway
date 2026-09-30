'use strict';

const PizZip = require('pizzip');
const { createApp } = require('../src/app');

const TOKEN = 'test-token-test-token-test-token-test-token';

// 1x1 transparent PNG
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_DATA_URI = `data:image/png;base64,${PNG_BASE64}`;
// Not a decodable JPEG, but carries the JPEG magic bytes which is all the gateway checks.
const JPEG_DATA_URI = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]).toString('base64')}`;

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
    imageWidth: 200,
    imageHeight: 80,
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

module.exports = { TOKEN, PNG_DATA_URI, JPEG_DATA_URI, DOCX_MIME, buildDocx, startServer, buildForm, documentXml };
