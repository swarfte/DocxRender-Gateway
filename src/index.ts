import { createApp } from './app';

// Cloudflare Workers entry point. Configuration comes from the request env:
// - API_TOKEN (required, via `wrangler secret put API_TOKEN`)
// - optional limits, see src/config.ts
const app = createApp();

export default app;
