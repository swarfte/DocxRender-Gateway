# DocxRender Gateway

Synchronous REST service that fills a DOCX template with JSON data (text, loops, conditions, PNG/JPEG images) and returns the rendered `.docx`. See `spec.md` for the full specification.

`POST /templater/render` — `multipart/form-data` with fields `data` (`.json`) and `templater` (`.docx`), authenticated with `Authorization: Bearer <token>`.

## Run

```bash
docker compose up -d --build
docker compose logs docx-render-gateway   # first start prints the generated API token once
```

Token resolution: `API_TOKEN` env → `/app/secrets/api-token` (persisted in the `docx-render-secrets` volume) → generated on first start. Keep the volume, otherwise the token changes on rebuild.

Local (no Docker): `TOKEN_FILE=./secrets/api-token npm start`

## Test

```bash
npm test
curl -X POST http://localhost:3000/templater/render \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -F "data=@./sample.json;type=application/json" \
  -F "templater=@./template.docx" \
  --output rendered-output.docx
```

## Template syntax

`{name}`, `{customer.name}`, `{#items}…{/items}` (loops / booleans), `{%logo}` (image, alone in its paragraph; value is a `data:image/png|jpeg;base64,…` URI **or** an `http(s)://…` PNG/JPEG URL). Images render at a fixed 200×80 px.

## Configuration

See `.env.example`. Errors are returned as JSON `{ success:false, request_id, error:{code,message} }`; `details` is only included when `NODE_ENV` is not `production`.

## Known limitations

- The image module writes every image as `word/media/image_generated_N.png`, even JPEGs. Word normally sniffs the real format, but verify with your templates.
- Fixed image size (MVP); no SVG/GIF images.
- URL images are fetched server-side with SSRF guards: private/loopback/link-local addresses are blocked (checked at connect time, including after redirects), ports limited to 80/443, max 3 redirects, size cap `MAX_IMAGE_BYTES`, timeout `IMAGE_FETCH_TIMEOUT_MS`. Restrict further with `IMAGE_URL_ALLOWED_HOSTS`, or turn off with `IMAGE_URL_ENABLED=false`. Images hosted on an internal network are therefore not reachable by design.
