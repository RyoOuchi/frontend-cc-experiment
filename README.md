# Color Hunt frontend

React + TypeScript + Vite. Japanese UI based on the supplied player/admin wireframes, with responsive blue-and-yellow styling, accessible dialogs, and bundled fonts. No external images or font requests are required.

## Run

Requires Node.js 22.12+ and npm.

```sh
npm install
npm run dev
```

Open **http://localhost:5173/** for players and **http://localhost:5173/admin** for the host. Use separate tabs to test both roles. Sessions are stored per tab in `sessionStorage`, survive reloads, and contain server-issued bearer credentials. No game is created automatically.

1. On `/admin`, create a game and enter prompts, accepted English labels, and confidence thresholds. Four blank rows are provided; use the sample button for a quick start. Add, remove, or reorder up to 30 prompts.
2. Save the prompts to open the lobby. Share the six-character code.
3. Players enter the code and a unique display name (1–20 characters). Prepare camera permissions before the round.
4. Start the game. All clients derive the 3-second countdown and 15-second timer from server timestamps. Future prompts are omitted from player responses.
5. Players capture, preview, retake, and submit one compressed photo. There is no photo-library picker. The host reviews submissions and records the judgment and reason.
6. Results wait for every accepted submission to be judged. The host can correct judgments, start the next round, and show the final podium.

Camera capture requires **HTTPS or localhost**, plus permission. An ordinary `http://192.168...` LAN URL is not sufficient for smartphone camera access; serve the app and API through a trusted HTTPS origin for physical-device testing. The backend prints a LAN address for viewing, not a camera-compatible HTTPS URL.

## Endpoints: one place to change

**[`src/endpoints.ts`](src/endpoints.ts) is the complete frontend endpoint configuration.** It contains HTTP methods and paths, API and WebSocket origins, OIDC login URLs, event names, timeouts, and polling interval. Components contain no endpoint paths.

```sh
cp .env.example .env.local
```

Set `VITE_API_BASE_URL` to the **complete prefix**, for example `https://your-api.example.com/prod`. Do not append an extra `/api` unless it is part of your backend path. Restart Vite after changing environment variables; rebuild for deployment.

- `VITE_WS_URL`: optional WebSocket API Gateway URL. The adapter requests a short-lived connection ticket, reconnects with backoff, and fetches fresh state after events and reconnection. HTTP polling continues once per second, including with WebSockets connected, so the backend can advance round deadlines without a scheduler.
- `VITE_ADMIN_AUTH_MODE=token`: host access-code login for the supplied Lambda backend. Enter the code in the host UI; only its hash is configured on Lambda. `oidc` keeps the Cognito/OIDC public-client authorization code + PKCE flow and uses the other `VITE_ADMIN_*` settings. Never embed host access codes, AWS keys or client secrets in `VITE_*` values.
- `src/api.ts`: typed request and upload adapter; adjust here if your backend's request/response shapes differ.
- `src/types.ts`: frontend data contracts.

See [`docs/API.md`](docs/API.md) for bodies, responses, authorization, upload confirmation, and event details. This is a frontend implementation and local test service; live AWS infrastructure must implement that contract.

The Python backend in [`../backend/`](../backend/README.md) implements all 16 supplied routes, bulk prompt save, with compatible JSON responses, plus optional WebSocket tickets. It uses manual photo judging; the retry compatibility route returns 409. Both supplied URLs are saved in [`.env.aws.example`](.env.aws.example). Deploy the backend before copying that template to `.env.local`; the template is not loaded automatically, so the local demo remains available. See [`docs/AWS.md`](docs/AWS.md) for connection settings.

## Local demo service

The new API is under `/api/v1` in `server/color-hunt.mjs`. It persists room state and photos under `.data/color-hunt/` and issues random room-scoped admin/player tokens. Every accepted photograph starts `PENDING`; only host actions judge it. Unreviewed photos stay hidden on the photo wall; the host can open a private review, confirm safety, or mark the photo blocked. Judging changes are audited locally. Scores are recomputed from accepted timestamps, with ties and no double addition.

The local service allows anyone to **create a demo host session**. It is not a production Cognito replacement. It uses one JSON file and a single process, has no production rate limits, and uses HTTP polling rather than a local WebSocket server. Upload tickets are held in memory; an unconfirmed upload must be retaken after a server restart. Photo URLs are signed and expire within two minutes. Finished-game photos older than 24 hours and results older than seven days are cleaned up at server startup; production needs scheduled S3 cleanup.

The previous `/api/rooms` prototype remains in `server/app.mjs` and `server/store.mjs` for compatibility with its original integration tests. The Color Hunt frontend does not call it. Do not deploy this development Express service as the AWS production backend.

## Commands

```sh
npm run dev    # Frontend + local demo service
npm run build  # Strict TypeScript check and production static bundle in dist/
npm test       # Local HTTP integration tests
npm start      # Built frontend + local demo service
```

`PORT=3000 npm run dev` changes the local server port. `npm run preview` only serves static files; configure a live API to use it, or use `npm start` for the bundled demo.

## Verification and limits

Automated HTTP tests cover joining, duplicate/invalid names, prompt validation, role checks, hidden countdown prompts, image tickets, private photo visibility, one submission per player/round, deadline boundaries, idempotent retries, competition ranking, judging in reverse order, score corrections, unresolved `ERROR` states, state persistence, multiple rounds, and final totals. The original prototype tests are retained.

Browser QA covers the join page at desktop and 390px width, host creation and prompt configuration, lobby participation, synchronized round progression, timeout handling, and final standings. Physical iPhone/Android cameras, AWS signed uploads, and optional API Gateway WebSocket integration require live backend and device testing.

## Structure

```text
src/endpoints.ts              All service addresses, HTTP methods, and paths
src/api.ts                    Typed transport and upload adapter
src/auth.ts                   Administrator OIDC code + PKCE flow
src/hooks/useGame.ts           Session restoration, clock sync, realtime updates
src/components/Join.tsx       Player entry and rules
src/components/PlayerGame.tsx Waiting, countdown, round and result screens
src/components/PhotoFlow.tsx  Camera-only capture, compression, retake and upload
src/components/AdminGame.tsx  Host lobby, live review and round progression
src/components/PromptEditor.tsx Ordered prompt editing and judging rules
src/components/Shared.tsx     Branding, player lists, ranking and podium
server/color-hunt.mjs         Local manual-judging service
```

Manrope and DM Sans are bundled under their SIL Open Font licenses in `public/fonts/licenses/`. Icons use Lucide (ISC). Existing unused prototype photographs are retained in `public/images/`.
