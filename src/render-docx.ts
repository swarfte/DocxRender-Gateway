import Docxtemplater from 'docxtemplater';
import expressionParser from 'docxtemplater/expressions.js';
import { HttpError, errors } from './errors';
import { loadDocx } from './validate-docx';
import { applyImageSizes, assertSupportedImages, createImageModule } from './image-module';
import type { ImageUrlConfig } from './config';
import type { JsonValue } from './validate-json';

// docxtemplater would print multi-errors (template excerpts and stacks) to the
// console; errorLogging: false keeps them out of the structured logs.
function describeError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  const details: Array<{ tag?: string; message: string }> = [];
  const inner = (err as { properties?: { errors?: unknown[] } })?.properties?.errors;
  const list = Array.isArray(inner) ? inner : [err];
  for (const e of list) {
    const p = ((e as { properties?: Record<string, unknown> })?.properties) || {};
    details.push({
      tag: (p.xtag as string) || (p.tag as string) || undefined,
      message:
        (p.explanation as string) ||
        ((e as Error)?.message as string) ||
        'Unknown template error',
    });
  }
  return errors.renderFailed(details);
}

async function renderCore(
  template: Uint8Array,
  data: JsonValue,
  urlOptions: ImageUrlConfig,
): Promise<Uint8Array> {
  try {
    assertSupportedImages(data);
    applyImageSizes(data);
    const zip = loadDocx(template);
    const doc = new Docxtemplater(zip, {
      modules: [createImageModule(urlOptions)],
      parser: expressionParser,
      paragraphLoop: true,
      linebreaks: true,
      errorLogging: false,
    });
    await doc.renderAsync(data);
    const output = doc.getZip().generate({ type: 'uint8array', compression: 'DEFLATE' });
    if (!output.length) throw errors.internal();
    return output;
  } catch (err) {
    throw describeError(err);
  }
}

// Renders with a timeout; the response is 504 RENDER_TIMEOUT when the deadline
// is exceeded. (Workers have no worker threads to terminate, so the losing
// render is simply abandoned; the runtime's own CPU limits bound the work.)
export async function renderDocx({
  template,
  data,
  urlOptions,
  timeoutMs,
}: {
  template: Uint8Array;
  data: JsonValue;
  urlOptions: ImageUrlConfig;
  timeoutMs: number;
}): Promise<Uint8Array> {
  // Yield to the event loop before starting: concurrent requests must observe
  // the busy window (worker-thread startup provided this boundary in Node),
  // and a wall-clock deadline can only preempt renders between macrotasks.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const work = renderCore(template, data, urlOptions);
  let timer: number | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(errors.timeout()), timeoutMs);
  });
  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    clearTimeout(timer);
    // The losing render must not surface as an unhandled rejection.
    work.catch(() => {});
  }
}
