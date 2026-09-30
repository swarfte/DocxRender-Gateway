'use strict';

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const errors = {
  unauthorized: () => new HttpError(401, 'UNAUTHORIZED', 'A valid Bearer token is required.'),
  badRequest: (code, message) => new HttpError(400, code, message),
  tooLarge: () => new HttpError(413, 'PAYLOAD_TOO_LARGE', 'One or more uploaded files exceed the allowed size.'),
  unsupported: (message) => new HttpError(415, 'UNSUPPORTED_FILE_TYPE', message),
  renderFailed: (details) => new HttpError(422, 'TEMPLATE_RENDER_FAILED', 'The DOCX template could not be rendered.', details),
  busy: () => new HttpError(429, 'TOO_MANY_REQUESTS', 'The render service is currently busy. Please retry later.'),
  internal: () => new HttpError(500, 'INTERNAL_ERROR', 'An unexpected rendering error occurred.'),
  timeout: () => new HttpError(504, 'RENDER_TIMEOUT', 'The document was not rendered within the allowed time.'),
};

module.exports = { HttpError, errors };
