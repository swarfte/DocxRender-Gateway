'use strict';

const { errors } = require('./errors');

const MAX_DEPTH = 50;

function depthExceeds(value, limit) {
  const stack = [[value, 1]];
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (node && typeof node === 'object') {
      if (depth > limit) return true;
      for (const child of Object.values(node)) stack.push([child, depth + 1]);
    }
  }
  return false;
}

function parseData(buffer) {
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw errors.badRequest('INVALID_JSON', 'The uploaded data file is not valid JSON.');
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw errors.badRequest('INVALID_JSON_ROOT', 'The JSON root must be an object or an array.');
  }
  if (depthExceeds(parsed, MAX_DEPTH)) {
    throw errors.badRequest('JSON_TOO_DEEP', `The JSON nesting depth exceeds ${MAX_DEPTH}.`);
  }
  return parsed;
}

module.exports = { parseData };
