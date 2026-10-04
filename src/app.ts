import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { HttpError, errors } from './errors';
import { bearerAuth } from './auth';
import { parseUpload } from './upload';
import { parseData } from './validate-json';
import { loadDocx } from './validate-docx';
import { renderDocx } from './render-docx';
import { resolveConfig } from './config';
import { configureLogger, logger } from './logger';
import type { AppEnv } from './app-env';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// report.docx -> report_rendered.docx; falls back when no base name is derivable.
function outputFilename(templateName: string): string {
  const base = templateName.replace(/\.[^.]*$/, '');
  return base ? `${base}_rendered.docx` : 'rendered-output.docx';
}

// RFC 6266/5987: quoted ASCII fallback plus a UTF-8 form so non-ASCII names survive.
function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '\\$&');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function createApp() {
  const app = new Hono<AppEnv>();
  // Per-isolate concurrent render counter (per process in the Express version).
  let activeRenders = 0;

  // Assign a request id first so every response (including 401) carries one.
  app.use('*', async (c, next) => {
    c.set('requestId', crypto.randomUUID());
    c.set('startedAt', Date.now());
    await next();
    c.res.headers.set('X-Request-Id', c.get('requestId'));
  });

  app.post('/templater/render', bearerAuth(), async (c) => {
    const config = resolveConfig(c.env);
    configureLogger(c.env.LOG_LEVEL);

    const totalLength = Number(c.req.header('content-length'));
    if (Number.isFinite(totalLength) && totalLength > config.maxTotalBytes) throw errors.tooLarge();

    const { data: dataFile, templater: templateFile } = await parseUpload(c, config);

    if (activeRenders >= config.maxConcurrentRenders) throw errors.busy();
    activeRenders += 1;
    const renderStarted = Date.now();
    try {
      // fail fast with 415 before touching the JSON
      loadDocx(new Uint8Array(await templateFile.arrayBuffer()));
      const data = parseData(new Uint8Array(await dataFile.arrayBuffer()));
      const output = await renderDocx({
        template: new Uint8Array(await templateFile.arrayBuffer()),
        data,
        urlOptions: config.imageUrl,
        timeoutMs: config.renderTimeoutMs,
      });
      logger.info('render_completed', {
        request_id: c.get('requestId'),
        remote_ip: c.req.header('cf-connecting-ip'),
        template_size_bytes: templateFile.size,
        data_size_bytes: dataFile.size,
        output_size_bytes: output.length,
        render_duration_ms: Date.now() - renderStarted,
        status: 200,
      });
      return new Response(output, {
        status: 200,
        headers: {
          'Content-Type': DOCX_MIME,
          'Content-Disposition': contentDisposition(outputFilename(templateFile.name)),
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      c.set('renderDurationMs', Date.now() - renderStarted);
      throw err;
    } finally {
      activeRenders -= 1;
    }
  });

  app.notFound((c) => errorResponse(c, new HttpError(404, 'NOT_FOUND', 'Route not found.')));

  app.onError((err, c) => errorResponse(c, err instanceof HttpError ? err : errors.internal()));

  return app;
}

function errorResponse(c: Context<AppEnv>, httpError: HttpError): Response {
  const config = resolveConfig(c.env);
  configureLogger(c.env.LOG_LEVEL);

  logger[httpError.status >= 500 ? 'error' : 'warn']('request_failed', {
    request_id: c.get('requestId'),
    remote_ip: c.req.header('cf-connecting-ip'),
    template_size_bytes: c.get('uploadSizes')?.templateSizeBytes,
    data_size_bytes: c.get('uploadSizes')?.dataSizeBytes,
    render_duration_ms: c.get('renderDurationMs'),
    status: httpError.status,
    error_code: httpError.code,
  });

  const body: Record<string, unknown> = {
    success: false,
    request_id: c.get('requestId'),
    error: { code: httpError.code, message: httpError.message },
  };
  if (httpError.details && config.nodeEnv !== 'production') {
    (body.error as Record<string, unknown>).details = httpError.details;
  }
  return c.json(body, httpError.status as ContentfulStatusCode, { 'Cache-Control': 'no-store' });
}

export type { AppEnv };
