const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export type LogLevel = keyof typeof LEVELS;

// Configured once per request from the LOG_LEVEL binding (defaults to info).
let threshold: number = LEVELS.info;

export function configureLogger(level: string | undefined): void {
  threshold = LEVELS[level as LogLevel] ?? LEVELS.info;
}

// Structured JSON logger. Callers must only pass non-sensitive fields.
function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields });
  (level === 'error' ? console.error : console.log).call(console, line);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => log('debug', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => log('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => log('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => log('error', event, fields),
};
