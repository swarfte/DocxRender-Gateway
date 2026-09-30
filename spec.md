1. 結論與服務名稱

可以。建議先建立一個獨立的 Node.js REST service，再用 Docker 包裝，完成後即可原封不動搬到公司 Docker 環境。

我建議服務名稱使用：

DocxRender Gateway

原因：

DocxRender 清楚表明用途
Gateway 表示由 n8n 經 API 提交 Template 和 Data
不綁死某個 Proposal workflow
日後可供其他 DOCX workflow 重用
Docker service name 可簡化為 docx-render-gateway

建議命名：

專案名稱：DocxRender Gateway
npm package：docx-render-gateway
Docker image：docx-render-gateway
Docker service：docx-render-gateway
API base path：/templater
Render endpoint：POST /templater/render

其他可選名稱：

TemplateRender API
DocxForge
DocxTemplater Gateway
Document Render Service

以下 Spec 以 DocxRender Gateway 為正式名稱。

2. 目標

建立一個可透過 Docker 部署的 DOCX Rendering Service，接收：

一份 data.json
一份 template.docx

服務使用：

docxtemplater
pizzip
@slosarek/docxtemplater-image-module-free

將 JSON 資料及圖片填入 DOCX Template，完成後直接回傳生成的 .docx binary。

@slosarek/docxtemplater-image-module-free 版本 1.2.0 標示支援 Docxtemplater 3.x，圖片 Tag 使用 {%image}，而 DOCX 中的圖片 Tag 應獨佔一個段落。

3. 整體架構
   n8n
   │
   │ POST /templater/render
   │ Authorization: Bearer <token>
   │ multipart/form-data
   │
   ├── data data.json
   └── templater template.docx
   │
   ▼
   DocxRender Gateway
   │
   ├── 驗證 Bearer Token
   ├── 驗證上傳欄位
   ├── 驗證 JSON
   ├── 驗證 DOCX package
   ├── 解析 Base64 圖片
   ├── Docxtemplater render
   └── 回傳 rendered.docx
   │
   ▼
   n8n Binary Data

4. API 規格
   4.1 Endpoint
   POST /templater/render

這是服務唯一的業務 API。

不需要：

/template/upload
/render/status
/render/download

每次 request 同步完成：

接收 Template + JSON
→ Render
→ 回傳 DOCX

4.2 Authentication

使用 Bearer Token：

Authorization: Bearer <API_TOKEN>

缺少 Token：

HTTP 401 Unauthorized

Token 錯誤：

HTTP 401 Unauthorized

錯誤內容不要透露：

正確 Token
Token 長度
Token 儲存路徑
Token 前後字元

回應範例：

{
"success": false,
"error": {
"code": "UNAUTHORIZED",
"message": "A valid Bearer token is required."
}
}

4.3 Request Content Type

必須是：

Content-Type: multipart/form-data

不要讓呼叫端手動設定 multipart boundary，由 n8n、curl 或 HTTP client 自動產生。

使用 Multer 可以接收 multipart/form-data，並透過指定欄位名稱取得上傳檔案。

4.4 File Fields

Request 必須包含兩個 file fields。

JSON File
Field name: data
Required: Yes
Max count: 1
Expected extension: .json
Expected MIME types:

- application/json
- text/json
- application/octet-stream

JSON Root 可以是：

Object

或：

Array

但你的 Proposal workflow 一般應使用 Object。

例子：

{
"customer_name": "University of Macau",
"proposal_title": "PCMS Proposal",
"customer_logo": "data:image/png;base64,iVBORw0KGgoAAA...",
"products": [
{
"product_name": "Product A",
"description": "Description A"
}
]
}

DOCX Template
Field name: templater
Required: Yes
Max count: 1
Expected extension: .docx
Expected MIME type:
application/vnd.openxmlformats-officedocument.wordprocessingml.document

服務不能只靠副檔名或 MIME type 判斷，還要檢查：

開頭是否是 ZIP signature
是否包含 [Content_Types].xml
是否包含 word/document.xml

DOCX 本質上是 ZIP/XML package，因此上述檢查可以排除部分明顯無效上傳。

5. 成功回應

成功時：

HTTP 200 OK

Headers：

Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
Content-Disposition: attachment; filename="rendered-output.docx"
X-Request-Id: <uuid>
Cache-Control: no-store

Body：

Rendered DOCX binary

成功回應不要再包成 JSON：

{
"success": true,
"file": "base64..."
}

直接回傳 binary 可避免：

Base64 增加約三分一體積
n8n 再做一次 Base64 decoding
記憶體額外浪費
Response size 增長 6. Template 語法規格
6.1 普通文字

Template：

Customer: {customer_name}

JSON：

{
"customer_name": "University of Macau"
}

6.2 Object 欄位

Template：

Customer: {customer.name}
Address: {customer.address}

JSON：

{
"customer": {
"name": "University of Macau",
"address": "Avenida da Universidade"
}
}

是否支援 dot notation 取決於選用的 Docxtemplater parser。實作時應使用支援 nested object 的 parser，例如 Angular expressions parser，否則可先將資料扁平化。

6.3 Loop

Template：

{#products}
Product: {product_name}
Description: {description}
{/products}

JSON：

{
"products": [
{
"product_name": "Product A",
"description": "Description A"
},
{
"product_name": "Product B",
"description": "Description B"
}
]
}

6.4 Boolean 條件

Template：

{#is_require_table_lite}
Gaming Table (Table-Lite)
{/is_require_table_lite}

JSON：

{
"is_require_table_lite": true
}

false 時隱藏整個 section：

{
"is_require_table_lite": false
}

6.5 圖片

Template：

{%customer_logo}

要求：

{%customer_logo} 獨佔一個 Word paragraph
不需要插入佔位圖片
不需要 Alt Text
不要使用 Carbone 的 {d.customer_logo}
第一版固定使用預設圖片尺寸

第三方圖片 Module 的 package 說明指出，DOCX 圖片 Tag 應放在 dedicated paragraph，並由 getImage() 回傳圖片 Buffer、getSize() 回傳尺寸。

JSON：

{
"customer_logo": "data:image/png;base64,iVBORw0KGgoAAA..."
}

第一版支援：

data:image/png;base64,...
data:image/jpeg;base64,...
data:image/jpg;base64,...

第一版不支援：

http://example.com/image.png
https://example.com/image.png
file:///image.png
/app/images/image.png
SVG
GIF

先只支援 Data URI，可以避免：

SSRF
內網 URL 掃描
DNS 問題
Redirect
圖片網站防盜鏈
外部服務 timeout
Async rendering 複雜度 7. 圖片尺寸規格

第一版先使用固定最大尺寸：

Width: 200 px
Height: 80 px

適用於 Proposal 左上角 Logo。

Image Module options 概念：

{
centered: false,
fileType: 'docx',

getImage(tagValue) {
// Data URI → Buffer
},

getSize(imageBuffer, tagValue, tagName) {
return [200, 80];
}
}

但固定 [200, 80] 可能令某些 Logo 變形。

因此建議分兩階段：

MVP
所有 Logo 使用固定 200 × 80 px

第二版

加入 image-size package 計算原圖尺寸，限制在：

最大寬度：200 px
最大高度：80 px
保持原始比例
不放大較小的圖片

建議 MVP 先完成固定尺寸，確認圖片 Module 和 Docxtemplater 相容後，再實作比例縮放。

8. API Token 生成規格

你要求 Docker 啟動時自動生成 Bearer Token。這裡有一個重要問題：

如果每次 container restart 都生成全新 Token，n8n Credential 會立即失效。

因此應採用以下優先順序。

Token Resolution Order
優先級 1：環境變數

如果存在：

API_TOKEN

服務直接使用該值。

適合公司正式部署：

environment:
API_TOKEN: ${DOCX_RENDER_API_TOKEN}

優先級 2：讀取持久化 Token File

如果沒有 API_TOKEN，檢查：

/app/secrets/api-token

如果檔案存在：

讀取 Token
驗證 Token 長度
繼續使用同一條 Token
優先級 3：第一次啟動時生成

兩者都不存在時：

使用 cryptographically secure random bytes
生成 Base64URL Token
寫入：
/app/secrets/api-token

將檔案權限設為：
0600

在 startup log 輸出一次：
Generated API token:
<token>

Store this token in the n8n Header Auth credential.
Token file: /app/secrets/api-token

建議使用：

crypto.randomBytes(48).toString('base64url')

約可產生 64 個 URL-safe 字元。

Docker Volume

為避免 Token 在重啟後消失：

volumes:

- docx-render-secrets:/app/secrets

如果沒有掛載 volume：

docker compose down
docker compose up

可能會令 Token 重新生成。

Token 不應這樣處理

不要：

每次啟動都強制生成新 Token

不要：

把 Token 寫死在 Dockerfile

不要：

把 Token commit 到 GitHub

不要：

將 Token 以普通 workflow field 儲存

公司 n8n 應使用：

Header Auth Credential

Header：

Authorization

Value：

Bearer <token>

9. 輸入限制

建議 MVP 使用以下限制。

最大 request 大小：35 MB
最大 templater：25 MB
最大 data：10 MB
每個 field 最大檔案數：1
總檔案數：2
最大 JSON nesting depth：可選，建議 50
Render timeout：120 秒
Concurrent renders：預設 2

Multer 支援針對 multipart upload 設置檔案大小、檔案數、欄位數等限制。

10. 錯誤回應規格

所有失敗回應使用：

Content-Type: application/json

統一格式：

{
"success": false,
"request_id": "4f8e67a8-5dc7-4e5c-a694-cb302b505d46",
"error": {
"code": "ERROR_CODE",
"message": "Human-readable error message."
}
}

HTTP 400

適用於：

缺少 data
缺少 templater
JSON 無法解析
JSON root 不合法
多於一個同名檔案
Multipart 格式錯誤

例子：

{
"success": false,
"request_id": "uuid",
"error": {
"code": "INVALID_JSON",
"message": "The uploaded data file is not valid JSON."
}
}

HTTP 401

適用於：

沒有 Authorization header
不是 Bearer scheme
Token 不正確
{
"success": false,
"request_id": "uuid",
"error": {
"code": "UNAUTHORIZED",
"message": "A valid Bearer token is required."
}
}

HTTP 413

適用於：

Template 超過限制
JSON 超過限制
完整 request 超過限制
{
"success": false,
"request_id": "uuid",
"error": {
"code": "PAYLOAD_TOO_LARGE",
"message": "One or more uploaded files exceed the allowed size."
}
}

HTTP 415

適用於：

Template 不是 DOCX
Data 不是 JSON
圖片 Data URI 類型不支援
DOCX package 結構不正確
{
"success": false,
"request_id": "uuid",
"error": {
"code": "UNSUPPORTED_FILE_TYPE",
"message": "The templater field must contain a valid DOCX file."
}
}

HTTP 422

適用於：

Docxtemplater Tag 語法錯誤
Loop marker 不成對
圖片 Tag 無法解析
Base64 圖片無效
Template 可讀但無法 render
{
"success": false,
"request_id": "uuid",
"error": {
"code": "TEMPLATE_RENDER_FAILED",
"message": "The DOCX template could not be rendered."
}
}

在開發模式可加入：

{
"details": [
{
"tag": "customer_logo",
"message": "Invalid PNG Data URI"
}
]
}

正式模式不要回傳：

Stack trace
Server file path
Package path
Token
完整 JSON
Template 原始內容
HTTP 429

適用於：

Rate limit exceeded
Concurrent render limit exceeded
{
"success": false,
"request_id": "uuid",
"error": {
"code": "TOO_MANY_REQUESTS",
"message": "The render service is currently busy. Please retry later."
}
}

HTTP 500

適用於：

未預期 server error
Output buffer 無法生成
無法完成 Word package write
{
"success": false,
"request_id": "uuid",
"error": {
"code": "INTERNAL_ERROR",
"message": "An unexpected rendering error occurred."
}
}

HTTP 504

適用於：

Render 超過 120 秒
{
"success": false,
"request_id": "uuid",
"error": {
"code": "RENDER_TIMEOUT",
"message": "The document was not rendered within the allowed time."
}
}

11. Logging 規格

每次 request 只記錄：

timestamp
request_id
remote_ip
template_size_bytes
data_size_bytes
render_duration_ms
response_status
output_size_bytes

例如：

{
"level": "info",
"event": "render_completed",
"request_id": "uuid",
"template_size_bytes": 1832440,
"data_size_bytes": 48291,
"output_size_bytes": 1940211,
"render_duration_ms": 1328,
"status": 200
}

不能記錄：

完整 data.json
Base64 圖片
Bearer Token
客戶名稱
Pricing
聯絡人
Proposal 內容
生成後文件

12. 檔案處理策略

MVP 建議使用 Multer memory storage：

template → Buffer
data → Buffer

原因：

只有兩個檔案
已限制大小
不必在 disk 建立及清理 temp files
Render 完成後由 Node.js GC 回收
避免資料殘留在 /tmp

但因 template 可達 25 MB，而且 output 又會生成一份 DOCX，單次 render 可能同時佔用：

Template Buffer

- Parsed ZIP
- JSON
- Images
- Output Buffer

實際記憶體可能高於上傳檔案體積數倍。

建議 Docker memory limit：

512 MB 至 1 GB

初始並行 render：

2

不要一開始允許大量 parallel render。

13. 建議目錄結構
    docx-render-gateway/
    ├── src/
    │ ├── server.js
    │ ├── app.js
    │ ├── auth.js
    │ ├── token-manager.js
    │ ├── upload.js
    │ ├── validate-docx.js
    │ ├── validate-json.js
    │ ├── image-module.js
    │ ├── render-docx.js
    │ ├── errors.js
    │ └── logger.js
    ├── test/
    │ ├── fixtures/
    │ │ ├── minimal-template.docx
    │ │ ├── minimal-data.json
    │ │ └── logo.png
    │ ├── render.test.js
    │ ├── auth.test.js
    │ └── validation.test.js
    ├── secrets/
    │ └── .gitkeep
    ├── .dockerignore
    ├── .env.example
    ├── .gitignore
    ├── Dockerfile
    ├── docker-compose.yml
    ├── package.json
    ├── package-lock.json
    └── README.md

14. Package 規格

建議 dependencies：

{
"dependencies": {
"@slosarek/docxtemplater-image-module-free": "1.2.0",
"docxtemplater": "<經PoC核實後鎖定的3.x版本>",
"express": "<鎖定版本>",
"multer": "<鎖定版本>",
"pizzip": "<鎖定版本>"
}
}

第二版可加入：

{
"image-size": "<鎖定版本>",
"express-rate-limit": "<鎖定版本>",
"helmet": "<鎖定版本>",
"pino": "<鎖定版本>"
}

最重要的是不要寫：

{
"docxtemplater": "^3.0.0"
}

或：

{
"@slosarek/docxtemplater-image-module-free": "latest"
}

因為 Image Module 與 Docxtemplater 之間可能存在相容性問題。PoC 成功後應將所有依賴鎖定，並保留 package-lock.json。

該 Image Module 自稱支援 Docxtemplater 3.x，但仍必須以實際 Template 測試相容性。

15. Environment Variables
    PORT=3000
    NODE_ENV=production

# 可選。如果沒有提供，服務會讀取或生成 /app/secrets/api-token

API_TOKEN=

MAX_TEMPLATE_BYTES=26214400
MAX_DATA_BYTES=10485760
MAX_TOTAL_BYTES=36700160

RENDER_TIMEOUT_MS=120000
MAX_CONCURRENT_RENDERS=2

DEFAULT_IMAGE_WIDTH=200
DEFAULT_IMAGE_HEIGHT=80

LOG_LEVEL=info

16. Docker 規格
    Docker Image

建議基礎 image：

node:<固定LTS版本>-alpine

但不要使用：

node:latest

要求：

使用非 root user
只複製 production dependencies
不包含測試文件
不包含真實 API Token
不包含真實 Template
/app/secrets 可寫
Application source 其餘位置盡量唯讀
Docker Compose 概念
services:
docx-render-gateway:
build:
context: .
container_name: docx-render-gateway
restart: unless-stopped

    ports:
      - "3000:3000"

    environment:
      NODE_ENV: production
      PORT: 3000
      MAX_TEMPLATE_BYTES: 26214400
      MAX_DATA_BYTES: 10485760
      MAX_TOTAL_BYTES: 36700160
      RENDER_TIMEOUT_MS: 120000
      MAX_CONCURRENT_RENDERS: 2

    volumes:
      - docx-render-secrets:/app/secrets

    mem_limit: 1g
    cpus: 1.0

volumes:
docx-render-secrets:

公司正式部署時建議不要直接暴露：

3000:3000

應放在：

Nginx / Traefik / company reverse proxy

後面，並由 proxy 提供 HTTPS。

17. Docker 啟動流程

Container 啟動時：

1. 讀取環境設定
2. 檢查 /app/secrets
3. 如果 API_TOKEN 已設定，使用 API_TOKEN
4. 否則檢查 /app/secrets/api-token
5. 如果 Token file 存在，載入 Token
6. 如果不存在，生成新 Token並寫入檔案
7. 驗證 Token 最小長度
8. 載入 Docxtemplater dependencies
9. 啟動 Express server
10. 監聽 0.0.0.0:3000

Startup log：

DocxRender Gateway
Version: 1.0.0
Port: 3000
Environment: production
Endpoint: POST /templater/render
Authentication: Bearer Token
Token source: generated file
Token file: /app/secrets/api-token
Ready

如果是第一次生成，可額外顯示 Token：

Generated API token:
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

如果是從舊 Token file 載入，不應再次完整打印 Token，只顯示：

API token loaded from persistent storage.

18. Render 處理流程
    收到 POST /templater/render
    ↓
    產生 request_id
    ↓
    驗證 Bearer Token
    ↓
    檢查 Content-Type
    ↓
    Multer 只接受 data、templater
    ↓
    檢查兩個欄位各有且只有一個檔案
    ↓
    檢查檔案大小
    ↓
    驗證 DOCX ZIP signature 與內部必要檔案
    ↓
    解析 data.json
    ↓
    驗證 JSON root
    ↓
    掃描 Data URI 圖片格式及大小
    ↓
    建立 PizZip instance
    ↓
    建立 Image Module instance
    ↓
    建立 Docxtemplater instance
    ↓
    Render data
    ↓
    生成 nodebuffer
    ↓
    檢查 output buffer
    ↓
    回傳 rendered-output.docx
    ↓
    清除 reference

19. n8n 呼叫規格

n8n 使用 HTTP Request node。

Basic Settings
Method:
POST

URL:
https://your-render-domain/templater/render

Authentication:
Header Auth

Header Auth：

Name:
Authorization

Value:
Bearer <generated-token>

Body
Send Body:
Enabled

Body Content Type:
Form-Data

Field 1：data
Parameter Type:
n8n Binary File

Name:
data

Input Data Field Name:
dataJson

Field 2：templater
Parameter Type:
n8n Binary File

Name:
templater

Input Data Field Name:
templateDocx

這表示進入 HTTP Request node 前，item 必須有：

binary.dataJson
binary.templateDocx

Response
Response Format:
File

Put Output in Field:
data

成功後：

binary.data

應包含：

fileName: rendered-output.docx
mimeType: application/vnd.openxmlformats-officedocument.wordprocessingml.document

20. curl 測試規格
    curl \
     -X POST \
     "http://localhost:3000/templater/render" \
     -H "Authorization: Bearer YOUR_API_TOKEN" \
     -F "data=@./sample.json;type=application/json" \
     -F "templater=@./template.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" \
     --output rendered-output.docx

驗證輸出：

file rendered-output.docx

並測試 ZIP 結構：

unzip -t rendered-output.docx

預期：

No errors detected

21. Acceptance Criteria
    Functional
    可以接收 data JSON file
    可以接收 templater DOCX file
    可以替換普通文字
    可以處理 array loop
    可以處理 Boolean section
    可以插入 PNG Base64 圖片
    可以插入 JPEG Base64 圖片
    成功後直接回傳 DOCX binary
    Word 可以正常開啟生成文件
    Bearer Token 錯誤時拒絕 request
    Template Tag 錯誤時回傳可識別錯誤
    Security
    無 Token 無法 render
    Token 不記錄於 request log
    不永久儲存 Template、JSON 和輸出文件
    不接受額外 upload fields
    有檔案大小限制
    有 render timeout
    不接受 HTTP／HTTPS 圖片 URL
    不回傳 stack trace
    Container 使用非 root user
    Token 可透過持久化 volume 保存
    Operational
    docker compose up -d 後自動啟動
    第一次啟動自動產生 Token
    Restart 後 Token 不變
    可以查看 request ID 和 render duration
    Container restart 不會遺失 API Token
    相同輸入可產生一致結構的 DOCX
22. MVP 範圍

第一版只做：

POST /templater/render
Bearer Authentication
data.json upload
template.docx upload
普通文字
Loop
Boolean section
PNG/JPEG Base64 圖片
固定圖片尺寸
同步回傳 DOCX
Docker deployment
持久化 Token
URL 圖片

第一版不要做：

SVG
PDF conversion
HTML rendering
Template storage
Render history
Database
Web UI
多 API key
User management
Async job queue
Webhook
Generated document storage

先把最小流程跑通，避免再次因為加入太多功能而難以定位問題。

23. 主要風險
    Module 相容性

@slosarek/docxtemplater-image-module-free 是第三方免費 Module，雖然標示支援 Docxtemplater 3.x，但並不保證與所有 3.x 版本完全相容。

因此開發時第一項測試應是：

最小 Template

- 一個文字 Tag
- 一張 PNG

成功後立即鎖定：

Node.js version
Docxtemplater version
PizZip version
Image Module version

API Token 重生

如果沒有持久化 /app/secrets，container 重建後會產生新 Token，n8n Credential 隨即失效。

所以這項不是 optional：

volumes:

- docx-render-secrets:/app/secrets

記憶體

大型 DOCX、Base64 圖片和 Output Buffer 會同時佔用記憶體。MVP 應限制並行 render 數量為 2，並為 container 預留至少 512 MB，建議 1 GB。

24. 建議實作順序
    建立 Node.js project。
    安裝並鎖定 dependencies。
    實作 Token Manager。
    實作 Bearer middleware。
    實作 multipart upload。
    實作 JSON validator。
    實作 DOCX package validator。
    建立最小文字 render。
    加入 @slosarek/docxtemplater-image-module-free。
    加入 PNG Data URI。
    加入 JPEG Data URI。
    加入統一錯誤格式。
    加入 timeout 及 concurrency limit。
    建立 Dockerfile。
    建立 Docker Compose。
    用 curl 測試。
    用虛構資料從 n8n 測試。
    確認成功後搬到公司 Docker。
    最終建議

服務名稱採用：

DocxRender Gateway

Repository：

docx-render-gateway

Docker service：

docx-render-gateway

API：

POST /templater/render

Authentication：

Authorization: Bearer <token>

Upload fields：

data
templater

這份 Spec 已經足夠作為第一版 MVP 的實作基準。最關鍵的設計決定是：Token 只在首次啟動生成，之後透過 Docker volume 持久保存，而不是每次 restart 都換一條 Token。
