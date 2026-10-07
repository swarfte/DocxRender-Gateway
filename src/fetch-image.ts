// Image fetching on Workers. There is no DNS API here, so the SSRF guard
// validates literal IP addresses in the URL itself (loopback, private,
// link-local ranges); Workers additionally blocks private addresses at the
// edge for any hostname that has to be resolved.

const MAX_REDIRECTS = 3;

export interface FetchImageOptions {
  allowedHosts: string[];
  allowedPorts: number[];
  allowPrivate: boolean;
  maxBytes: number;
  timeoutMs: number;
}

const V4_BLOCKS: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

const V6_BLOCKS: Array<[string, number]> = [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32],
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function isBlockedIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return V4_BLOCKS.some(([base, prefix]) => {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) return false;
    const shift = 32 - prefix;
    return value >>> shift === baseInt >>> shift;
  });
}

// Parses an IPv6 address into a BigInt; returns null when it is not valid IPv6.
function parseIPv6(ip: string): bigint | null {
  if (!/^[0-9a-f:.]+$/i.test(ip)) return null;
  // Dotted-quad tail (e.g. ::ffff:1.2.3.4) becomes two hextets.
  let text = ip;
  const v4Tail = /[.:]\d{1,3}(\.\d{1,3}){3}$/i.exec(text);
  if (v4Tail) {
    const v4 = ipv4ToInt(v4Tail[0].slice(1));
    if (v4 === null) return null;
    text = text.slice(0, text.length - v4Tail[0].length) + (v4 >>> 16).toString(16) + ':' + (v4 & 0xffff).toString(16);
  }
  const sections = text.split('::');
  if (sections.length > 2) return null;
  const head = sections[0] ? sections[0].split(':').filter(Boolean) : [];
  const tail = sections.length === 2 && sections[1] ? sections[1].split(':').filter(Boolean) : [];
  if (head.some((g) => g.length > 4) || tail.some((g) => g.length > 4)) return null;
  const missing = 8 - head.length - tail.length;
  if (sections.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...new Array<string>(missing).fill('0'), ...tail];
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(parseInt(group || '0', 16));
  return value;
}

function isBlockedIPv6(ip: string): boolean {
  const value = parseIPv6(ip);
  if (value === null) return false;
  return V6_BLOCKS.some(([base, prefix]) => {
    const baseValue = parseIPv6(base);
    if (baseValue === null) return false;
    const shift = BigInt(128 - prefix);
    return value >> shift === baseValue >> shift;
  });
}

// Addresses an image URL must never point at (SSRF protection).
export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) return isBlockedIPv4(mapped[1]);
  if (address.includes(':')) return isBlockedIPv6(address);
  return isBlockedIPv4(address);
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Image exceeds the allowed size.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function requestOnce(
  url: URL,
  options: FetchImageOptions,
): Promise<{ buffer?: Uint8Array; redirect?: URL }> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!options.allowPrivate && isBlockedAddress(host)) {
    throw new Error('Image URL host is not allowed.');
  }
  const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
  if (!options.allowPrivate && !options.allowedPorts.includes(port)) {
    throw new Error('Image URL port is not allowed.');
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs),
      headers: { Accept: 'image/png,image/jpeg,image/webp,image/avif,image/gif,image/*;q=0.8', 'User-Agent': 'DocxRender-Gateway' },
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error('Image request timed out.');
    }
    throw err instanceof Error ? err : new Error('Image request failed.');
  }

  const location = res.headers.get('location');
  if ([301, 302, 303, 307, 308].includes(res.status) && location) {
    await res.body?.cancel();
    try {
      return { redirect: new URL(location, url) };
    } catch {
      throw new Error('Image URL is not valid.');
    }
  }
  if (res.status !== 200) {
    await res.body?.cancel();
    throw new Error(`Image request failed with status ${res.status}.`);
  }
  const declared = Number(res.headers.get('content-length'));
  if (declared > options.maxBytes) {
    await res.body?.cancel();
    throw new Error('Image exceeds the allowed size.');
  }
  return { buffer: await readCapped(res, options.maxBytes) };
}

export async function fetchImage(urlString: string, options: FetchImageOptions): Promise<Uint8Array> {
  let url: URL;
  try {
    url = new URL(urlString.trim());
  } catch {
    throw new Error('Image URL is not valid.');
  }
  if (options.allowedHosts.length && !options.allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error('Image URL host is not in the allowed list.');
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Only http(s) image URLs are supported.');
    }
    if (url.username || url.password) throw new Error('Image URL must not contain credentials.');
    if (options.allowedHosts.length && !options.allowedHosts.includes(url.hostname.toLowerCase())) {
      throw new Error('Image URL host is not in the allowed list.');
    }
    const result = await requestOnce(url, options);
    if (result.buffer) return result.buffer;
    url = result.redirect!;
  }
  throw new Error('Image URL redirected too many times.');
}
