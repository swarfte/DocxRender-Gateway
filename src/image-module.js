'use strict';

const ImageModule = require('@slosarek/docxtemplater-image-module-free');
const { errors } = require('./errors');
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
  if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) {
    if (!urlOptions.enabled) throw new Error('Image URLs are disabled.');
    return assertImageContent(await fetchImage(value, urlOptions));
  }
  return decodeDataUri(value);
}

function createImageModule({ width, height, urlOptions }) {
  return new ImageModule({
    centered: false,
    fileType: 'docx',
    getImage: (tagValue) => loadImage(tagValue, urlOptions),
    getSize: () => [width, height],
  });
}

module.exports = { createImageModule, assertSupportedImages, decodeDataUri };
