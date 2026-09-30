'use strict';

const ImageModule = require('@slosarek/docxtemplater-image-module-free');
const { errors } = require('./errors');
const { imageSize } = require('image-size');
const { fetchImage } = require('./fetch-image');

const DATA_URI = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

// Decodes a PNG/JPEG Data URI into a Buffer. Anything else (URLs, SVG, GIF, paths) is rejected.
function decodeDataUri(value) {
  if (typeof value !== 'string') {
    throw new Error('Image tag value must be a Data URI string.');
  }
  const match = DATA_URI.exec(value.trim());
  if (!match) {
    throw new Error('Image must be a base64 PNG or JPEG Data URI.');
  }
  const buffer = Buffer.from(match[2], 'base64');
  const isPng = buffer.subarray(0, 4).equals(PNG_MAGIC);
  const isJpeg = buffer.subarray(0, 3).equals(JPEG_MAGIC);
  const claimsPng = match[1].toLowerCase() === 'png';
  if (!(claimsPng ? isPng : isJpeg)) {
    throw new Error('Image content does not match its Data URI type.');
  }
  return buffer;
}

// Pre-scan: reject data:image/* strings of an unsupported type (e.g. svg, gif) with 415.
function assertSupportedImages(root) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (typeof node === 'string') {
      // Only the header is inspected here; full validation happens in getImage.
      if (/^data:image\//i.test(node) && !/^data:image\/(png|jpe?g);base64,/i.test(node)) {
        throw errors.unsupported('Only PNG and JPEG base64 Data URI images are supported.');
      }
    } else if (node && typeof node === 'object') {
      for (const child of Object.values(node)) stack.push(child);
    }
  }
}

// Accepts PNG/JPEG only, judged by content rather than by the declared type.
function assertImageContent(buffer, expectPng) {
  const isPng = buffer.subarray(0, 4).equals(PNG_MAGIC);
  const isJpeg = buffer.subarray(0, 3).equals(JPEG_MAGIC);
  if (!(isPng || isJpeg) || (expectPng === true && !isPng) || (expectPng === false && !isJpeg)) {
    throw new Error('Image content is not a supported PNG or JPEG.');
  }
  return buffer;
}

async function loadImage(value, urlOptions) {
  if (value && typeof value === 'object') value = value.src;
  if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) {
    if (!urlOptions.enabled) throw new Error('Image URLs are disabled.');
    return assertImageContent(await fetchImage(value, urlOptions));
  }
  return decodeDataUri(value);
}

const SIZE_SUFFIX = '{size}';
const SIZE_PATTERN = /^(\d{1,5})\s*[xX×]\s*(\d{1,5})$/;

function parseSize(key, value) {
  const match = typeof value === 'string' ? SIZE_PATTERN.exec(value.trim()) : null;
  const width = match && Number(match[1]);
  const height = match && Number(match[2]);
  if (!match || width < 1 || height < 1) {
    throw errors.badRequest('INVALID_IMAGE_SIZE', `"${key}" must be an image size like 300x200.`);
  }
  return [width, height];
}

// Consumes sibling "<name>{size}": "WxH" keys from the data: removes them and attaches the size
// to the "<name>" image value as { src, size }, so it is scoped to that exact object (loops included).
function applyImageSizes(root) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (!Array.isArray(node)) {
      for (const key of Object.keys(node)) {
        if (!key.endsWith(SIZE_SUFFIX) || key.length === SIZE_SUFFIX.length) continue;
        const size = parseSize(key, node[key]);
        const name = key.slice(0, -SIZE_SUFFIX.length);
        delete node[key];
        if (typeof node[name] === 'string') node[name] = { src: node[name], size };
      }
    }
    for (const child of Object.values(node)) stack.push(child);
  }
  return root;
}

// Explicit size from the data (<name>{size}) wins; otherwise use the image's own pixel size.
function resolveSize(img, tagValue) {
  if (tagValue && typeof tagValue === 'object' && tagValue.size) return tagValue.size;
  let dims;
  try {
    dims = imageSize(img);
  } catch {
    throw new Error('Could not read the image dimensions.');
  }
  if (!dims.width || !dims.height) throw new Error('Could not read the image dimensions.');
  return [dims.width, dims.height];
}

function createImageModule({ urlOptions }) {
  return new ImageModule({
    centered: false,
    fileType: 'docx',
    getImage: (tagValue) => loadImage(tagValue, urlOptions),
    getSize: (img, tagValue) => resolveSize(img, tagValue),
  });
}

module.exports = { createImageModule, assertSupportedImages, applyImageSizes, decodeDataUri };
