'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { HttpError, errors } = require('./errors');

const WORKER_FILE = path.join(__dirname, 'render-worker.js');

// Renders in a worker thread; rejects with HttpError on failure or timeout.
function renderDocx({ template, data, imageWidth, imageHeight, urlOptions, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_FILE, {
      workerData: { template, data, imageWidth, imageHeight, urlOptions },
    });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, errors.timeout()), timeoutMs);

    worker.once('message', (msg) => {
      if (msg.ok) {
        const output = Buffer.from(msg.output.buffer, msg.output.byteOffset, msg.output.byteLength);
        if (!output.length) return finish(reject, errors.internal());
        return finish(resolve, output);
      }
      const { status, code, message, details } = msg.error;
      finish(reject, new HttpError(status, code, message, details));
    });
    worker.once('error', () => finish(reject, errors.internal()));
    worker.once('exit', (exitCode) => {
      if (exitCode !== 0) finish(reject, errors.internal());
    });
  });
}

module.exports = { renderDocx };
