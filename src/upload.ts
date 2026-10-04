import type { Context } from 'hono';
import { errors } from './errors';
import type { AppEnv, UploadedFiles } from './app-env';
import type { Config } from './config';

type BodyValue = string | File | Array<string | File>;

function asArray(value: BodyValue | undefined): BodyValue[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Multer-equivalent multipart parsing for the two required file fields.
 *
 * Observable semantics kept from the Express version:
 * - non-multipart content type      -> 400 INVALID_CONTENT_TYPE
 * - malformed multipart body        -> 400 INVALID_MULTIPART
 * - any text field (fields: 0)      -> 400 INVALID_UPLOAD
 * - unknown / duplicate file fields -> 400 INVALID_UPLOAD
 * - any single part over the
 *   per-file template cap, or data
 *   over its cap                    -> 413 PAYLOAD_TOO_LARGE
 * - missing fields                  -> 400 MISSING_DATA / MISSING_TEMPLATER
 */
export async function parseUpload(c: Context<AppEnv>, config: Config): Promise<UploadedFiles> {
  const contentType = c.req.header('content-type') || '';
  if (!/^multipart\/form-data/i.test(contentType)) {
    throw errors.badRequest('INVALID_CONTENT_TYPE', 'Content-Type must be multipart/form-data.');
  }

  let body: Record<string, BodyValue>;
  try {
    body = await c.req.parseBody({ all: true });
  } catch {
    throw errors.badRequest('INVALID_MULTIPART', 'The multipart request body is malformed.');
  }

  for (const [key, value] of Object.entries(body)) {
    const values = asArray(value);
    if (values.some((v) => typeof v === 'string')) {
      // LIMIT_FIELD_*: text fields are not accepted.
      throw errors.badRequest('INVALID_UPLOAD', 'Unexpected or duplicate upload fields.');
    }
    if (key !== 'data' && key !== 'templater') {
      // LIMIT_UNEXPECTED_FILE: only data and templater are accepted.
      throw errors.badRequest('INVALID_UPLOAD', 'Unexpected or duplicate upload fields.');
    }
  }

  const dataFiles = asArray(body['data']).filter((v): v is File => typeof v !== 'string');
  const templaterFiles = asArray(body['templater']).filter((v): v is File => typeof v !== 'string');
  if (dataFiles.length > 1 || templaterFiles.length > 1) {
    // maxCount: 1 per field.
    throw errors.badRequest('INVALID_UPLOAD', 'Unexpected or duplicate upload fields.');
  }

  const data = dataFiles[0];
  const templater = templaterFiles[0];
  // Multer enforced fileSize: maxTemplateBytes on every part while streaming,
  // before the presence checks; the data cap was re-checked afterwards.
  const present = [data, templater].filter((file): file is File => !!file);
  if (present.some((file) => file.size > config.maxTemplateBytes) || (data && data.size > config.maxDataBytes)) {
    throw errors.tooLarge();
  }
  if (!data) throw errors.badRequest('MISSING_DATA', 'The data file field is required.');
  if (!templater) throw errors.badRequest('MISSING_TEMPLATER', 'The templater file field is required.');

  c.set('uploadSizes', { templateSizeBytes: templater.size, dataSizeBytes: data.size });
  return { data, templater };
}
