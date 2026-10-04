import { createMiddleware } from 'hono/factory';
import { errors } from './errors';
import type { AppEnv } from './app-env';

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

// Constant-time comparison over equal-length digests.
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function bearerAuth() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const header = c.req.header('authorization') || '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    const { API_TOKEN: token } = c.env;
    // Hash both sides so the comparison is over equal-length, fixed-cost inputs.
    const ok =
      !!token && !!match && timingSafeEqual(await sha256(match[1]), await sha256(token));
    if (!ok) throw errors.unauthorized();
    await next();
  });
}
