'use strict';

const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const MAX_REDIRECTS = 3;

// Addresses an image URL must never resolve to (SSRF protection).
const blocked = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].forEach(([net4, prefix]) => blocked.addSubnet(net4, prefix, 'ipv4'));
[['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32]]
  .forEach(([net6, prefix]) => blocked.addSubnet(net6, prefix, 'ipv6'));

function isBlockedAddress(address) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  const family = net.isIPv6(address) ? 'ipv6' : 'ipv4';
  return blocked.check(address, family);
}

function ssrfError() {
  return new Error('Image URL host is not allowed.');
}

// Validates the address actually used for the connection, so DNS rebinding can't bypass the check.
function guardedLookup(allowPrivate) {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      if (!allowPrivate && addresses.some((a) => isBlockedAddress(a.address))) {
        return callback(ssrfError());
      }
      if (options && options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

function requestOnce(url, { allowPrivate, timeoutMs, maxBytes, allowedPorts }) {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && !allowPrivate && isBlockedAddress(host)) return reject(ssrfError());
    const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
    if (!allowPrivate && !allowedPorts.includes(port)) return reject(new Error('Image URL port is not allowed.'));

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      { method: 'GET', lookup: guardedLookup(allowPrivate), timeout: timeoutMs, headers: { Accept: 'image/png,image/jpeg', 'User-Agent': 'DocxRender-Gateway' } },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return resolve({ redirect: new URL(res.headers.location, url) });
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Image request failed with status ${res.statusCode}.`));
        }
        const declared = Number(res.headers['content-length']);
        if (declared > maxBytes) {
          res.destroy();
          return reject(new Error('Image exceeds the allowed size.'));
        }
        const chunks = [];
        let total = 0;
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > maxBytes) return req.destroy(new Error('Image exceeds the allowed size.'));
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('Image request timed out.')));
    req.on('error', reject);
    req.end();
  });
}

async function fetchImage(urlString, options) {
  let url;
  try {
    url = new URL(urlString.trim());
  } catch {
    throw new Error('Image URL is not valid.');
  }
  if (options.allowedHosts.length && !options.allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error('Image URL host is not in the allowed list.');
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) image URLs are supported.');
    if (url.username || url.password) throw new Error('Image URL must not contain credentials.');
    if (options.allowedHosts.length && !options.allowedHosts.includes(url.hostname.toLowerCase())) {
      throw new Error('Image URL host is not in the allowed list.');
    }
    const result = await requestOnce(url, options);
    if (result.buffer) return result.buffer;
    url = result.redirect;
  }
  throw new Error('Image URL redirected too many times.');
}

module.exports = { fetchImage, isBlockedAddress };
