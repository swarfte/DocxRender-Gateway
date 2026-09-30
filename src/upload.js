'use strict';

const multer = require('multer');
const { errors } = require('./errors');

function createUpload(config) {
  const multerInstance = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.maxTemplateBytes, // per-file cap; data is re-checked below
      files: 2,
      fields: 0,
      parts: 2,
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
