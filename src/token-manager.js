'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MIN_TOKEN_LENGTH = 32;
const DEFAULT_TOKEN_FILE = '/app/secrets/api-token';

// Resolution order: API_TOKEN env -> persisted token file -> generate and persist.
function resolveToken({ env = process.env, tokenFile = env.TOKEN_FILE || DEFAULT_TOKEN_FILE } = {}) {
  const fromEnv = (env.API_TOKEN || '').trim();
  if (fromEnv) {
    assertLength(fromEnv, 'API_TOKEN');
    return { token: fromEnv, source: 'environment', tokenFile, generated: false };
  }

  if (fs.existsSync(tokenFile)) {
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    assertLength(token, tokenFile);
    return { token, source: 'persisted file', tokenFile, generated: false };
  }

  const token = crypto.randomBytes(48).toString('base64url');
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  fs.writeFileSync(tokenFile, token + '\n', { mode: 0o600 });
  try { fs.chmodSync(tokenFile, 0o600); } catch { /* best effort (e.g. Windows) */ }
  return { token, source: 'generated file', tokenFile, generated: true };
}

function assertLength(token, origin) {
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`API token from ${origin} is shorter than ${MIN_TOKEN_LENGTH} characters.`);
  }
}

module.exports = { resolveToken, MIN_TOKEN_LENGTH };
