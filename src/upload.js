'use strict';

const multer = require('multer');
const { errors } = require('./errors');

const MAX_SIZE_FIELDS = 100;
const SIZE_PATTERN = /^(\d{1,5})\s*[xX×]\s*(\d{1,5})$/;
const RESERVED_FIELDS = new Set(['data', 'templater']);

// Text fields such as client_icon=50x50 override the size (px) of the {%client_icon} image tag.
function parseImageSizes(body) {
  const sizes = new Map();
  for (const [name, value] of Object.entries(body || {})) {
    const match = RESERVED_FIELDS.has(name) || typeof value !== 'string' ? null : SIZE_PATTERN.exec(value.trim());
    const width = match && Number(match[1]);
    const height = match && Number(match[2]);
    if (!match || width < 1 || height < 1) {
      throw errors.badRequest('INVALID_IMAGE_SIZE', `Field "${name}" must be an image size like 300x200.`);
    }
    sizes.set(name, [width, height]);
  }
  return sizes;
}

function createUpload(config) {
  const multerInstance = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.maxTemplateBytes, // per-file cap; data is re-checked below
      files: 2,
      fields: MAX_SIZE_FIELDS,
      fieldSize: 64,
      fieldNameSize: 200,
      parts: 2 + MAX_SIZE_FIELDS,
    },
  }).fields([
    { name: 'data', maxCount: 1 },
    { name: 'templater', maxCount: 1 },
  ]);

  return (req, res, next) => {
    const type = req.get('content-type') || '';
    if (!/^multipart\/form-data/i.test(type)) {
      return next(errors.badRequest('INVALID_CONTENT_TYPE', 'Content-Type must be multipart/form-data.'));
    }

    multerInstance(req, res, (err) => {
      if (err) return next(translateMulterError(err));

      const data = req.files && req.files.data && req.files.data[0];
      const templater = req.files && req.files.templater && req.files.templater[0];
      if (!data) return next(errors.badRequest('MISSING_DATA', 'The data file field is required.'));
      if (!templater) return next(errors.badRequest('MISSING_TEMPLATER', 'The templater file field is required.'));
      if (data.size > config.maxDataBytes || templater.size > config.maxTemplateBytes) {
        return next(errors.tooLarge());
      }
      try {
        req.imageSizes = parseImageSizes(req.body);
      } catch (e) {
        return next(e);
      }
      req.dataFile = data;
      req.templateFile = templater;
      next();
    });
  };
}

function translateMulterError(err) {
  if (err.code === 'LIMIT_FILE_SIZE') return errors.tooLarge();
  if (err instanceof multer.MulterError) {
    // LIMIT_UNEXPECTED_FILE, LIMIT_FILE_COUNT, LIMIT_FIELD_*, LIMIT_PART_COUNT
    return errors.badRequest('INVALID_UPLOAD', 'Unexpected or duplicate upload fields.');
  }
  // busboy parse errors (malformed multipart)
  return errors.badRequest('INVALID_MULTIPART', 'The multipart request body is malformed.');
}

module.exports = { createUpload };
