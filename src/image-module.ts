import ImageModule from '@slosarek/docxtemplater-image-module-free';
import { imageSize } from 'image-size';
import { errors } from './errors';
import { fetchImage } from './fetch-image';
import type { ImageUrlConfig } from './config';
import type { JsonValue } from './validate-json';

const DATA_URI = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, i) => bytes[i] === byte);
}

// The regex already restricts the charset; strip whitespace and rely on atob.
function base64ToUint8Array(base64: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(base64.replace(/\s+/g, ''));
  } catch {
    throw new Error('Image must be a base64 PNG or JPEG Data URI.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Decodes a PNG/JPEG Data URI into bytes. Anything else (URLs, SVG, GIF, paths) is rejected.
export function decodeDataUri(value: unknown): Uint8Array {
  if (typeof value !== 'string') {
    throw new Error('Image tag value must be a Data URI string.');
  }
  const match = DATA_URI.exec(value.trim());
  if (!match) {
    throw new Error('Image must be a base64 PNG or JPEG Data URI.');
  }
  const buffer = base64ToUint8Array(match[2]);
  const isPng = startsWith(buffer, PNG_MAGIC);
  const isJpeg = startsWith(buffer, JPEG_MAGIC);
  const claimsPng = match[1].toLowerCase() === 'png';
  if (!(claimsPng ? isPng : isJpeg)) {
    throw new Error('Image content does not match its Data URI type.');
  }
  return buffer;
}

// Pre-scan: reject data:image/* strings of an unsupported type (e.g. svg, gif) with 415.
export function assertSupportedImages(root: unknown): void {
  const stack: unknown[] = [root];
  while (stack.length) {
    const node = stack.pop();
    if (typeof node === 'string') {
      // Only the header is inspected here; full validation happens in loadImage.
      if (/^data:image\//i.test(node) && !/^data:image\/(png|jpe?g);base64,/i.test(node)) {
        throw errors.unsupported('Only PNG and JPEG base64 Data URI images are supported.');
      }
    } else if (node && typeof node === 'object') {
      for (const child of Object.values(node as Record<string, unknown>)) stack.push(child);
    }
  }
}

// Accepts PNG/JPEG only, judged by content rather than by the declared type.
function assertImageContent(buffer: Uint8Array, expectPng?: boolean): Uint8Array {
  const isPng = startsWith(buffer, PNG_MAGIC);
  const isJpeg = startsWith(buffer, JPEG_MAGIC);
  if (!(isPng || isJpeg) || (expectPng === true && !isPng) || (expectPng === false && !isJpeg)) {
    throw new Error('Image content is not a supported PNG or JPEG.');
  }
  return buffer;
}

async function loadImage(value: unknown, urlOptions: ImageUrlConfig): Promise<Uint8Array> {
  let resolved = value;
  if (resolved && typeof resolved === 'object') resolved = (resolved as { src?: unknown }).src;
  if (typeof resolved === 'string' && /^https?:\/\//i.test(resolved.trim())) {
    if (!urlOptions.enabled) throw new Error('Image URLs are disabled.');
    return assertImageContent(await fetchImage(resolved, urlOptions));
  }
  return decodeDataUri(resolved);
}

const SIZE_SUFFIX = '{size}';
const SIZE_PATTERN = /^(\d{1,5})\s*[xX×]\s*(\d{1,5})$/;

function parseSize(key: string, value: unknown): [number, number] {
  const match = typeof value === 'string' ? SIZE_PATTERN.exec(value.trim()) : null;
  const width = match && Number(match[1]);
  const height = match && Number(match[2]);
  if (!match || !width || !height || width < 1 || height < 1) {
    throw errors.badRequest('INVALID_IMAGE_SIZE', `"${key}" must be an image size like 300x200.`);
  }
  return [width, height];
}

// Consumes sibling "<name>{size}": "WxH" keys from the data: removes them and attaches the size
// to the "<name>" image value as { src, size }, so it is scoped to that exact object (loops included).
export function applyImageSizes(root: JsonValue): JsonValue {
  const stack: unknown[] = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (!Array.isArray(node)) {
      const record = node as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (!key.endsWith(SIZE_SUFFIX) || key.length === SIZE_SUFFIX.length) continue;
        const size = parseSize(key, record[key]);
        const name = key.slice(0, -SIZE_SUFFIX.length);
        delete record[key];
        if (typeof record[name] === 'string') record[name] = { src: record[name], size };
      }
    }
    for (const child of Object.values(node as Record<string, unknown>)) stack.push(child);
  }
  return root;
}

// Explicit size from the data (<name>{size}) wins; otherwise use the image's own pixel size.
function resolveSize(img: Uint8Array, tagValue: unknown): [number, number] {
  const explicit = tagValue as { size?: [number, number] } | null;
  if (explicit && typeof explicit === 'object' && explicit.size) return explicit.size;
  let dims: { width?: number; height?: number };
  try {
    dims = imageSize(img);
  } catch {
    throw new Error('Could not read the image dimensions.');
  }
  if (!dims.width || !dims.height) throw new Error('Could not read the image dimensions.');
  return [dims.width, dims.height];
}

export function createImageModule(urlOptions: ImageUrlConfig): ImageModule {
  return new ImageModule({
    centered: false,
    fileType: 'docx',
    getImage: (tagValue: unknown) => loadImage(tagValue, urlOptions),
    getSize: (img: Uint8Array, tagValue: unknown) => resolveSize(img, tagValue),
  });
}
