'use strict';

const pkg = require('../package.json');
const { createApp } = require('./app');
const { resolveToken } = require('./token-manager');

const intEnv = (name, fallback) => {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const config = {
  port: intEnv('PORT', 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  maxTemplateBytes: intEnv('MAX_TEMPLATE_BYTES', 26214400),
  maxDataBytes: intEnv('MAX_DATA_BYTES', 10485760),
  maxTotalBytes: intEnv('MAX_TOTAL_BYTES', 36700160),
  renderTimeoutMs: intEnv('RENDER_TIMEOUT_MS', 120000),
  maxConcurrentRenders: intEnv('MAX_CONCURRENT_RENDERS', 2),
  imageUrl: {
    enabled: process.env.IMAGE_URL_ENABLED !== 'false',
    allowedHosts: (process.env.IMAGE_URL_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    allowedPorts: [80, 443],
    allowPrivate: process.env.IMAGE_URL_ALLOW_PRIVATE === 'true',
    maxBytes: intEnv('MAX_IMAGE_BYTES', 5242880),
    timeoutMs: intEnv('IMAGE_FETCH_TIMEOUT_MS', 10000),
  },
};

const tokenInfo = resolveToken();
const app = createApp({ token: tokenInfo.token, config });

app.listen(config.port, '0.0.0.0', () => {
  const lines = [
    'DocxRender Gateway',
    `Version: ${pkg.version}`,
    `Port: ${config.port}`,
    `Environment: ${config.nodeEnv}`,
    'Endpoint: POST /templater/render',
    'Authentication: Bearer Token',
    `Token source: ${tokenInfo.source}`,
  ];
  if (tokenInfo.source !== 'environment') lines.push(`Token file: ${tokenInfo.tokenFile}`);
  lines.push('Ready');
  console.log(lines.join('\n'));

  if (tokenInfo.generated) {
    console.log(
      `\nGenerated API token:\n${tokenInfo.token}\n\n` +
        `Store this token in the n8n Header Auth credential.\nToken file: ${tokenInfo.tokenFile}`,
    );
  } else if (tokenInfo.source === 'persisted file') {
    console.log('API token loaded from persistent storage.');
  }
});
