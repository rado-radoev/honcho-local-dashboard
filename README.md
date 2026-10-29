# Honcho Local Dashboard

A web dashboard for **self-hosted [Honcho](https://github.com/plastic-labs/honcho)** —
the memory server for AI agents (Hermes Agent and friends). Think of it as what
[app.honcho.dev](https://app.honcho.dev) does for Honcho Cloud, pointed at your
own instance: browse workspaces, peers, sessions, messages, conclusions,
representations, and peer cards, search memory, and ask questions about a peer
(the dialectic chat), plus create workspaces/peers/sessions, edit workspace
config, manage webhooks, mint API keys, run requests in the API Playground,
and view locally-measured performance stats — all against your local server.

The information architecture deliberately mirrors the cloud dashboard — same
sidebar sections in the same order (Get Started, Explore, Instance Status,
Performance, API Playground, API Keys, Webhooks, Members, Billing), same
terminology, same list → detail flows (Explore → Workspace → Peers/Sessions →
Utilities pages with tabs) — so anyone who knows the cloud UI finds this one
instantly familiar. The implementation, styling, and code are original; no
cloud assets are used. Only **Members** and **Billing** appear in the sidebar
with a `CLOUD` tag and an explainer: the self-hosted v3 API has no endpoints
for either (cloud organization / payment concepts), so there is no local data
to show and none is faked.

Page notes:

- **API Playground** loads the connected server's own `/openapi.json` live
  (in demo mode, a trimmed bundled copy of the 3.4.1 spec) and executes
  requests through the same connection/proxy/auth as the rest of the app.
- **Performance** is measured from *this dashboard's own requests* since
  connect — the self-hosted API exposes no server-side metrics endpoint.
- **API Keys** is create-only: `POST /v3/keys` exists, but the API has no
  list or revoke endpoint, so a created key is shown exactly once.
- **Webhooks** lists/creates/deletes per-workspace endpoints via
  `/v3/workspaces/{id}/webhooks`.
- **Settings** shows the real connection details (server, request route,
  server version) and Disconnect — nothing invented.

## Screenshots

`screenshots/` holds a PNG of every main view, captured from demo mode at
1600×1000 (see [Visual regression baselines](#visual-regression-baselines)).
In words: a dark sidebar with monospace navigation; an Explore page with a
workspaces table (Workspace ID / Created At / Metadata / Configuration); a
workspace overview with Peers and Sessions panels side by side; Peer Utilities
(Search / Chat / Sessions / Peer Card / Representation / Conclusions / Config)
and Session Utilities (Messages / Search / Context / Peers) tab pages; and an
Instance Status page with API health and per-workspace deriver queue counts.

## Quick start

```bash
npm install
npm run dev
```

Open the app, enter your Honcho server URL (default `http://localhost:8000`)
and — only if your server runs with `AUTH_USE_AUTH=true` — a JWT/API token,
then **Connect**. Settings persist in the browser's `localStorage`; the token
is stored only in your browser and sent only to your server.

**No server handy?** Click **Explore demo data** on the connect screen (or
open `/?demo=1`) to tour the whole UI with bundled sample data — the same
example workspace (`test-1`: alice, bob, charlie, two group chats) used in
Honcho's official dashboard screenshots, plus a small `hermes` workspace.

## How connection and auth work

- Health is checked with `GET /health` (expects `{"status":"ok"}`). The
  sidebar shows a green/red status dot, like the cloud sidebar.
- If a token is set, every request carries `Authorization: Bearer <token>`.
  Self-hosted Honcho with auth disabled ignores it.
- Views are hash-routed (`#/workspace/test-1/peers/alice?tab=chat`), so every
  screen is deep-linkable and bookmarkable.

## CORS and the dev proxy

The Honcho API does not reliably emit CORS headers for browser apps, so
calling it directly from a page served on another origin can be blocked by
the browser. This project handles that locally with Vite's proxy
(`/honcho-api` → `VITE_HONCHO_TARGET`, default `http://localhost:8000`),
used **when the server you connect to matches the proxy target**. For
loopback servers the host spelling does not need to match exactly:
`localhost`, `127.0.0.1`, `0.0.0.0`, and `[::1]` are treated as equivalent
as long as the port is the same — so connecting to
`http://127.0.0.1:8000` still uses the proxy when `VITE_HONCHO_TARGET` is
`http://localhost:8000` (and vice versa). Non-loopback hosts and loopback
URLs with a different port are called directly. Copy `.env.example` to
`.env` and set `VITE_HONCHO_TARGET` if your server lives elsewhere, then
connect using that URL (or an equivalent loopback spelling on the same
port). Whether a given build may use the proxy is decided by its Vite mode
(`shouldUseProxy` in `src/api/client.ts`):

- **Dev** (`npm run dev`, mode `development`): the dev server proxies
  `/honcho-api`, and the client uses it.
- **Preview** (`npm run build:preview && npm run preview`, mode
  `preview`): `vite preview` also proxies `/honcho-api` (see
  `preview.proxy` in `vite.config.ts`), and the preview build has the
  proxy flag baked in, so it uses it too. Build with `build:preview` —
  serving a plain production build under `vite preview` will *not* use
  the proxy and the browser will block the direct calls (CORS).
- Connecting to any other URL uses a direct fetch, which works only if that
  server allows CORS from the dashboard's origin.

**Production:** `npm run build` (mode `production`) never uses the proxy —
a static deployment has no `/honcho-api` endpoint. Serve the built
dashboard (`dist/`) from the **same origin** as the Honcho API, or put
both behind a reverse proxy — same-origin requests have no CORS problem
at all. Don't expose a no-auth Honcho server to the public internet just
to make CORS go away; put the dashboard on your LAN/Tailscale like the
server itself.

## Endpoints used (Honcho v3 API)

Verified against `docs/v3/openapi.json` and the FastAPI routers in
plastic-labs/honcho (main branch):

| Method | Path | Used for |
| --- | --- | --- |
| GET | `/health` | Connection health check |
| GET | `/openapi.json` | Server version on Instance Status (best effort) |
| POST | `/v3/workspaces/list` | Explore workspaces table |
| POST | `/v3/workspaces/{id}/peers/list` | Peers tables |
| GET | `/v3/workspaces/{id}/peers/{peer}/card` | Peer Card tab |
| POST | `/v3/workspaces/{id}/peers/{peer}/representation` | Representation tab |
| POST | `/v3/workspaces/{id}/conclusions/list` (filter `observed_id`) | Conclusions tab |
| POST | `/v3/workspaces/{id}/peers/{peer}/chat` | Chat (dialectic) tab |
| POST | `/v3/workspaces/{id}/peers/{peer}/search` | Peer Search tab |
| POST | `/v3/workspaces/{id}/peers/{peer}/sessions` | Peer Sessions tab |
| POST | `/v3/workspaces/{id}/sessions/list` | Sessions tables |
| POST | `/v3/workspaces/{id}/sessions/{session}/messages/list` | Session Messages tab |
| GET | `/v3/workspaces/{id}/sessions/{session}/peers` | Session Peers tab, message filter |
| GET | `/v3/workspaces/{id}/sessions/{session}/summaries` | Session summary panel |
| GET | `/v3/workspaces/{id}/sessions/{session}/context` | Session Context ("Get Context") tab |
| POST | `/v3/workspaces/{id}/sessions/{session}/search` | Session Search tab |
| POST | `/v3/workspaces/{id}/search` | Workspace Search |
| GET | `/v3/workspaces/{id}/queue/status` | Deriver queue on Instance Status |
| POST | `/v3/workspaces` | Create workspace (Explore) |
| PUT | `/v3/workspaces/{id}` | Edit workspace metadata/configuration |
| POST | `/v3/workspaces/{id}/peers` | Create peer |
| POST | `/v3/workspaces/{id}/sessions` | Create session |
| POST | `/v3/workspaces/{id}/sessions/{session}/peers` | Add checked peers to a session |
| POST | `/v3/keys` | Create an API key (shown once; no list/revoke in the API) |
| GET/POST | `/v3/workspaces/{id}/webhooks` | List / create webhooks |
| DELETE | `/v3/workspaces/{id}/webhooks/{endpoint}` | Delete a webhook |
| any | (Playground) | Generic execution of any spec endpoint |

## Development

```bash
npm run dev          # dev server with the /honcho-api proxy
npm test             # vitest: API client unit tests (mocked fetch)
npm run build        # type-check + production build into dist/
npm run build:preview && npm run preview  # local preview build (proxy on)
npm run screenshots  # see below
```

Stack: Vite + React + TypeScript, Tailwind CSS, lucide-react icons. The API
layer is an interface (`src/api/honchoApi.ts`) with two implementations —
`HonchoClient` (live HTTP) and `DemoHonchoApi` (fixtures) — which is what
makes demo mode and server-free screenshots possible.

## Visual regression baselines

```bash
npm run build
npm run screenshots
```

`scripts/screenshots.mjs` serves the production build via `vite preview`,
drives it with Playwright at a fixed 1600×1000 viewport, walks every main
view in demo mode (running the searches, the chat ask, and Get Context so
views are populated), and writes PNGs to `screenshots/`. It exits non-zero
if any view throws a page error. The committed PNGs are the baselines from
the current build — re-run and diff after UI changes.

## Roadmap (v2 ideas, not built)

- Writes: add messages from the UI
- Conclusion management: inspect sources, delete conclusions
  (`DELETE /v3/workspaces/{id}/conclusions/{conclusion_id}`)
- Representation/conclusion graphs: visualize observer → observed links
- Streaming chat responses (`stream: true` on the chat endpoint)

## License

MIT — see [LICENSE](LICENSE). Not affiliated with Plastic Labs; "Honcho" is
used descriptively (this dashboard is a client for the Honcho API).
Screenshots and documentation of the cloud dashboard referenced during
development belong to their respective owners and are not included here.
