'use strict';

import PizZip from 'pizzip';
import zlib from 'node:zlib';
import { createApp } from '../src/app';
import type { Env } from '../src/config';

export const TOKEN = 'test-token-test-token-test-token-test-token';

// 1x1 transparent PNG
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
export const PNG_DATA_URI = `data:image/png;base64,${PNG_BASE64}`;

// Solid-colour PNG of the given pixel size (valid, decodable).
export function pngDataUri(width: number, height: number): string {
  const chunk = (type: string, body: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), body])));
    return Buffer.concat([len, Buffer.from(type), body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

// JPEG with a valid SOI + SOF0 header of the given size (enough for size detection; not a viewable image).
export function jpegDataUri(width: number, height: number): string {
  const sof = Buffer.from([
    0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0,
  ]);
  const app0 = Buffer.from([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function paragraph(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

export function buildDocx(paragraphs: string[]): Uint8Array {
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
  return zip.generate({ type: 'uint8array' });
}

// The app resolves config from the env per request, so overrides are plain
// bindings instead of separate servers.
export function makeEnv(overrides: Record<string, string> = {}): Env {
  return { API_TOKEN: TOKEN, NODE_ENV: 'test', ...overrides };
}

export const app = createApp();

export function post(env: Env, form: FormData, headers: Record<string, string> = {}): Promise<Response> {
  return app.request(
    'http://localhost/templater/render',
    { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, ...headers }, body: form },
    env,
  );
}

export function buildForm({
  data,
  template,
  dataName = 'data',
  templateName = 'templater',
  extra,
}: {
  data?: unknown;
  template?: Uint8Array;
  dataName?: string;
  templateName?: string;
  extra?: boolean;
} = {}): FormData {
  const form = new FormData();
  if (data !== undefined) {
    const body =
      typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
    form.append(dataName, new Blob([body as BlobPart], { type: 'application/json' }), 'data.json');
  }
  if (template !== undefined) {
    form.append(templateName, new Blob([template as BlobPart], { type: DOCX_MIME }), 'template.docx');
  }
  if (extra) form.append('extra', new Blob(['x']), 'extra.txt');
  return form;
}

export function documentXml(docx: Uint8Array): string {
  return new PizZip(docx).file('word/document.xml')!.asText();
}
