# SanjayAIHub — Simple AI Server

A no-auth server with three tools:

- **Image generation** — Alibaba (Qwen-Image), Cloudflare (Flux Schnell), Pixazo (Flux Schnell), or Transloadit (nano-banana)
- **Image editing** — Alibaba (qwen-image-edit) or Transloadit (nano-banana), from a source image URL
- **Chat + prompt generation** — plain chat, or a mode that turns a short idea into a detailed image-generation prompt

Every generated/edited image is re-uploaded ("transloaded") to **imgbb**, so you get a permanent URL regardless of how long the AI provider keeps its own temp link alive. All requests and results are saved to **Postgres** (built for Railway's Postgres plugin) so you have a history of everything generated.

There is no login/auth — anyone who can reach the server can use it. Don't expose it publicly with real API keys unless that's what you want.

A minimal web UI ships at `/` (tabs for Generate / Edit / Chat, plus a "contact sheet" of recent history).

## Project layout

```
server.js              Express app entry point
db.js                   Postgres schema + query helpers
providers/
  alibaba.js             chat + image generation/edit
  cloudflare.js           image generation
  pixazo.js                image generation
  transloadit.js            image generation/edit (nano-banana via /image/generate Robot)
services/
  imgbb.js               uploads a URL or base64 image to imgbb
routes/
  chat.js                 POST /api/chat, GET /api/chat/:id
  image.js                POST /api/image/generate, POST /api/image/edit
  history.js               GET/DELETE /api/history/images
public/
  index.html              the web UI
```

## Environment variables

Copy `.env.example` to `.env` for local dev. On Railway, set these in your service's **Variables** tab (see deploy section below for `DATABASE_URL`).

| Variable | Required for | Notes |
|---|---|---|
| `DATABASE_URL` | everything DB-backed | Railway injects this automatically when you attach a Postgres plugin |
| `ALIBABA_API_KEY`, `ALIBABA_WORKSPACE_ID` | chat, prompt-gen, Alibaba image gen/edit (defaults) | DashScope / Model Studio |
| `ALIBABA_REGION` | optional | defaults to `ap-southeast-1` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Cloudflare image gen | Workers AI, free tier |
| `PIXAZO_API_KEY` | Pixazo image gen | free Flux Schnell |
| `TRANSLOADIT_AUTH_KEY`, `TRANSLOADIT_AUTH_SECRET` | Transloadit image gen/edit | from your Workspace's Credentials page |
| `IMGBB_API_KEY` | every image request | free key at https://api.imgbb.com/ |

Only set the keys for the providers you plan to use — an unconfigured provider just returns an error when called, everything else keeps working.

## Local development

```bash
npm install
cp .env.example .env   # fill in your keys + a local DATABASE_URL
npm start
```

Server listens on `http://localhost:3000` (or `PORT` if set). Visit `/` for the UI, or hit the API directly (see below).

## Deploying to Railway

1. Push this project to a GitHub repo (or use `railway up` from the CLI).
2. In Railway, create a new project from that repo — it will build using the included `Dockerfile`.
3. Add a **Postgres** plugin to the same project. Railway automatically injects `DATABASE_URL` into your service — you don't set it by hand.
4. In your service's **Variables** tab, add the provider keys you want to use (`ALIBABA_API_KEY`, `IMGBB_API_KEY`, etc. — see table above).
5. Deploy. The app runs `node server.js`, which creates its Postgres tables on boot if they don't exist yet.
6. Open the generated Railway URL — the UI is served at `/`.

## API reference

All endpoints are JSON in, JSON out. No auth headers needed.

### `POST /api/image/generate`
```json
{
  "prompt": "a lighthouse at dusk, storm clouds, teal and amber palette",
  "provider": "alibaba",        // alibaba | cloudflare | pixazo | transloadit
  "model": "qwen-image-3.0-pro", // optional, provider-specific
  "size": "1024*1024",           // alibaba: "W*H"; transloadit: use aspect_ratio instead
  "seed": 12345,                 // optional
  "num_steps": 4                 // cloudflare / pixazo only, max 8
}
```
Returns the saved history row, including `imgbb_url` (the permanent image URL).

### `POST /api/image/edit`
```json
{
  "prompt": "replace the sky with a starry night, keep everything else unchanged",
  "image_url": "https://example.com/source.jpg",
  "provider": "alibaba",  // alibaba | transloadit
  "model": "qwen-image-edit-plus" // optional
}
```

### `POST /api/chat`
```json
{
  "message": "a cat astronaut floating over Saturn",
  "mode": "prompt-generator",   // "chat" | "prompt-generator"
  "conversationId": 3           // omit to start a new conversation
}
```
Returns `{ conversationId, mode, reply }`. Send the returned `conversationId` on the next call to continue the same thread.

### `GET /api/chat/:conversationId`
Returns `{ conversation, messages }`.

### `GET /api/history/images?type=generate|edit&limit=&offset=`
List saved image records, newest first.

### `DELETE /api/history/images/:id`
Removes the DB record (does not delete the image from imgbb — use the row's `imgbb_delete_url` for that if you need it).

### `GET /api/health`
Reports which providers/DB are configured — useful for a quick sanity check after deploying.

## Notes on providers

- **Alibaba** is the default for both generation and editing — best quality, needs a DashScope workspace.
- **Cloudflare** and **Pixazo** are free, synchronous, text-to-image only (no editing).
- **Transloadit** wraps its `/image/generate` Robot (default model `google/nano-banana`), which supports both generation and general-purpose image editing by feeding a source image in as `image`. Transloadit imports the `image_url` itself via its `/http/import` Robot inside the same Assembly.
- imgbb only accepts base64 image data or file uploads, not remote URLs — so for URL-returning providers (Alibaba, Pixazo, Transloadit) the server downloads the image first and re-encodes it before uploading to imgbb.
