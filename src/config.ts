export interface ImageUrlConfig {
  enabled: boolean;
  allowedHosts: string[];
  allowedPorts: number[];
  allowPrivate: boolean;
  maxBytes: number;
  timeoutMs: number;
}

export interface Config {
  nodeEnv: string;
  maxTemplateBytes: number;
  maxDataBytes: number;
  maxTotalBytes: number;
  renderTimeoutMs: number;
  maxConcurrentRenders: number;
  imageUrl: ImageUrlConfig;
}

/**
 * Bindings accepted by the Worker. Only API_TOKEN is required; every limit
 * falls back to the same defaults as the original Node server.
 */
export interface Env {
  API_TOKEN?: string;
  NODE_ENV?: string;
  LOG_LEVEL?: string;
  MAX_TEMPLATE_BYTES?: string;
  MAX_DATA_BYTES?: string;
  MAX_TOTAL_BYTES?: string;
  RENDER_TIMEOUT_MS?: string;
  MAX_CONCURRENT_RENDERS?: string;
  IMAGE_URL_ENABLED?: string;
  IMAGE_URL_ALLOWED_HOSTS?: string;
  IMAGE_URL_ALLOW_PRIVATE?: string;
  MAX_IMAGE_BYTES?: string;
  IMAGE_FETCH_TIMEOUT_MS?: string;
}

const intEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function resolveConfig(env: Env): Config {
  if (!(env.API_TOKEN ?? '').trim()) {
    throw new Error('API_TOKEN is not configured. Set it with `wrangler secret put API_TOKEN`.');
  }
  return {
    nodeEnv: env.NODE_ENV || 'development',
    maxTemplateBytes: intEnv(env.MAX_TEMPLATE_BYTES, 26214400),
    maxDataBytes: intEnv(env.MAX_DATA_BYTES, 10485760),
    maxTotalBytes: intEnv(env.MAX_TOTAL_BYTES, 36700160),
    renderTimeoutMs: intEnv(env.RENDER_TIMEOUT_MS, 120000),
    maxConcurrentRenders: intEnv(env.MAX_CONCURRENT_RENDERS, 2),
    imageUrl: {
      enabled: env.IMAGE_URL_ENABLED !== 'false',
      allowedHosts: (env.IMAGE_URL_ALLOWED_HOSTS || '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
      allowedPorts: [80, 443],
      allowPrivate: env.IMAGE_URL_ALLOW_PRIVATE === 'true',
      maxBytes: intEnv(env.MAX_IMAGE_BYTES, 5242880),
      timeoutMs: intEnv(env.IMAGE_FETCH_TIMEOUT_MS, 10000),
    },
  };
}
