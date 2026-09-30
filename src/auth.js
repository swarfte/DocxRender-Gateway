'use strict';

const crypto = require('node:crypto');
const { errors } = require('./errors');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function bearerAuth(token) {
  const expected = sha256(token);
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    // Hash both sides so timingSafeEqual gets equal-length inputs.
    if (!match || !crypto.timingSafeEqual(sha256(match[1]), expected)) {
      return next(errors.unauthorized());
    }
    next();
  };
}

module.exports = { bearerAuth };
