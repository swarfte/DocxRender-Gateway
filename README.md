# DocxRender Gateway

Cloudflare Worker (Hono + TypeScript) that fills a DOCX template with JSON data (text, loops, conditions, PNG/JPEG images) and returns the rendered `.docx`. See `spec.md` for the original specification.

`POST /templater/render` — `multipart/form-data` with fields `data` (`.json`) and `templater` (`.docx`), authenticated with `Authorization: Bearer <token>`.

## Run

```bash
npm install
cp .dev.vars.example .dev.vars    # local dev vars incl. API_TOKEN
npm run dev                       # wrangler dev on http://localhost:8787
```

Deploy: store the token as a secret, then deploy.

```bash
npx wrangler secret put API_TOKEN   # generate a long random value (>= 32 chars)
npm run deploy
```

`API_TOKEN` is required — there is no generated-token fallback on Workers (no filesystem). Every limit has the same default as the original Node server and can be overridden via `vars` in `wrangler.jsonc` or per-environment secrets; see `.dev.vars.example` for the names.

## Test

```bash
npm test          # vitest — exercises the app the same way Workers does (Request in / Response out)
npm run typecheck
```

Manual check against a running dev server:

```bash
curl -X POST http://localhost:8787/templater/render \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -F "data=@./sample.json;type=application/json" \
  -F "templater=@./template.docx" \
  --output rendered-output.docx
```

## Template syntax

`{name}`, `{customer.name}`, `{#items}…{/items}` (loops / booleans), `{%logo}` (image, alone in its paragraph; value is a `data:image/png|jpeg;base64,…` URI **or** an `http(s)://…` PNG/JPEG URL). Images are inserted at their original pixel size. To scale one, add a sibling key `<name>{size}` with value `WxH` (px) in the data JSON, e.g. `"client_icon{size}": "50x50"` next to `"client_icon": "https://…"`; it applies only to that object (so per loop item). Images without a `{size}` key keep their original size.

## Configuration

Errors are returned as JSON `{ success:false, request_id, error:{code,message} }`; `details` is only included when `NODE_ENV` is not `production`.

| Binding | Default | Purpose |
| --- | --- | --- |
| `API_TOKEN` | — (required) | Bearer token for the render endpoint |
| `NODE_ENV` | `development` | `production` hides error `details` |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `MAX_TEMPLATE_BYTES` | `26214400` | templater cap (25 MB) |
| `MAX_DATA_BYTES` | `10485760` | data cap (10 MB) |
| `MAX_TOTAL_BYTES` | `36700160` | whole-request cap (35 MB) |
| `RENDER_TIMEOUT_MS` | `120000` | render deadline → `504 RENDER_TIMEOUT` |
| `MAX_CONCURRENT_RENDERS` | `2` | per-isolate limit → `429 TOO_MANY_REQUESTS` |
| `IMAGE_URL_ENABLED` | `true` | allow `http(s)` image values |
| `IMAGE_URL_ALLOWED_HOSTS` | — (all) | comma-separated host allow-list |
| `IMAGE_URL_ALLOW_PRIVATE` | `false` | permit literal private/loopback IPs in image URLs |
| `MAX_IMAGE_BYTES` | `5242880` | fetched-image cap |
| `IMAGE_FETCH_TIMEOUT_MS` | `10000` | per-request fetch timeout |

## Known limitations

- The image module writes every image as `word/media/image_generated_N.png`, even JPEGs. Word normally sniffs the real format, but verify with your templates.
- No SVG/GIF images. Original-size images are not shrunk to the page width, so large source images will overflow unless you give a `{size}` key.
- URL images are fetched with the guard set kept from the Node version: literal private/loopback/link-local IPs are rejected unless `IMAGE_URL_ALLOW_PRIVATE=true`, ports limited to 80/443, max 3 redirects, size cap `MAX_IMAGE_BYTES`, timeout `IMAGE_FETCH_TIMEOUT_MS`. Workers additionally cannot reach private networks at all, so hostname-based SSRF is excluded by the platform. Restrict further with `IMAGE_URL_ALLOWED_HOSTS`, or turn off with `IMAGE_URL_ENABLED=false`.
- Renders are abandoned at the `RENDER_TIMEOUT_MS` deadline (Workers have no worker threads to kill); the isolate's CPU limit is the hard backstop for runaway CPU-bound renders.
- `MAX_CONCURRENT_RENDERS` counts renders per isolate, matching the per-process limit of the Node version.
