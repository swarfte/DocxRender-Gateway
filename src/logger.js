'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] || LEVELS.info;

// Structured JSON logger. Callers must only pass non-sensitive fields.
function log(level, event, fields = {}) {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields });
  (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
}

module.exports = {
  debug: (e, f) => log('debug', e, f),
  info: (e, f) => log('info', e, f),
  warn: (e, f) => log('warn', e, f),
  error: (e, f) => log('error', e, f),
};
