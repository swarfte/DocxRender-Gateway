'use strict';

// Runs in a worker thread so a runaway render can be terminated on timeout.
const { parentPort, workerData } = require('node:worker_threads');

// docxtemplater prints multi-errors (with template excerpts and stacks) via console.log; keep them out of logs.
console.log = () => {};
const Docxtemplater = require('docxtemplater');
const expressionParser = require('docxtemplater/expressions.js');
const { loadDocx } = require('./validate-docx');
const { createImageModule, assertSupportedImages } = require('./image-module');

function describeError(err) {
  if (err && err.status && err.code) {
    return { status: err.status, code: err.code, message: err.message };
  }
  const details = [];
  const inner = err && err.properties && err.properties.errors;
  const list = Array.isArray(inner) ? inner : [err];
  for (const e of list) {
    const p = (e && e.properties) || {};
    details.push({
      tag: p.xtag || p.tag || undefined,
      message: p.explanation || (e && e.message) || 'Unknown template error',
    });
  }
  return { status: 422, code: 'TEMPLATE_RENDER_FAILED', message: 'The DOCX template could not be rendered.', details };
}

(async () => {
try {
  const { template, data, imageSizes, urlOptions, maxImage } = workerData;
  assertSupportedImages(data);
  const zip = loadDocx(Buffer.from(template));
  const doc = new Docxtemplater(zip, {
    modules: [createImageModule({ imageSizes, urlOptions, maxImage })],
    parser: expressionParser,
    paragraphLoop: true,
    linebreaks: true,
  });
  await doc.renderAsync(data);
  const output = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  parentPort.postMessage({ ok: true, output });
} catch (err) {
  parentPort.postMessage({ ok: false, error: describeError(err) });
}
})();
