'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { HttpError, errors } = require('./errors');
const { bearerAuth } = require('./auth');
const { createUpload } = require('./upload');
const { parseData } = require('./validate-json');
const { loadDocx } = require('./validate-docx');
const { renderDocx } = require('./render-docx');
const logger = require('./logger');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function createApp({ token, config }) {
  const app = express();
  app.disable('x-powered-by');
  let activeRenders = 0;

  // Assign a request id first so every response (including 401) carries one.
  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    req.startedAt = Date.now();
    res.set('X-Request-Id', req.id);
    next();
  });

  const capTotalSize = (req, res, next) => {
    const length = Number(req.get('content-length'));
    if (Number.isFinite(length) && length > config.maxTotalBytes) return next(errors.tooLarge());
    next();
  };

  app.post(
    '/templater/render',
    bearerAuth(token),
    capTotalSize,
    createUpload(config),
    async (req, res, next) => {
      if (activeRenders >= config.maxConcurrentRenders) return next(errors.busy());
      activeRenders += 1;
      const renderStarted = Date.now();
      try {
        loadDocx(req.templateFile.buffer); // fail fast with 415 before touching the JSON
        const data = parseData(req.dataFile.buffer);
        const output = await renderDocx({
          template: req.templateFile.buffer,
          data,
          imageSizes: req.imageSizes,
          urlOptions: config.imageUrl,
          timeoutMs: config.renderTimeoutMs,
        });
        res.set({
          'Content-Type': DOCX_MIME,
          'Content-Disposition': 'attachment; filename="rendered-output.docx"',
          'Cache-Control': 'no-store',
          'Content-Length': String(output.length),
        });
        res.status(200).end(output);
        logger.info('render_completed', {
          request_id: req.id,
          remote_ip: req.ip,
          template_size_bytes: req.templateFile.size,
          data_size_bytes: req.dataFile.size,
          output_size_bytes: output.length,
          render_duration_ms: Date.now() - renderStarted,
          status: 200,
        });
      } catch (err) {
        req.renderDurationMs = Date.now() - renderStarted;
        next(err);
      } finally {
        activeRenders -= 1;
        req.files = undefined; // drop buffer references
      }
    },
  );

  app.use((req, res, next) => next(new HttpError(404, 'NOT_FOUND', 'Route not found.')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const known = err instanceof HttpError;
    const httpError = known ? err : errors.internal();
    logger[httpError.status >= 500 ? 'error' : 'warn']('request_failed', {
      request_id: req.id,
      remote_ip: req.ip,
      template_size_bytes: req.templateFile && req.templateFile.size,
      data_size_bytes: req.dataFile && req.dataFile.size,
      render_duration_ms: req.renderDurationMs,
      status: httpError.status,
      error_code: httpError.code,
    });
    if (res.headersSent) return res.destroy();

    const body = {
      success: false,
      request_id: req.id,
      error: { code: httpError.code, message: httpError.message },
    };
    if (httpError.details && config.nodeEnv !== 'production') body.error.details = httpError.details;
    res.status(httpError.status).set('Cache-Control', 'no-store').json(body);
  });

  return app;
}

module.exports = { createApp };
