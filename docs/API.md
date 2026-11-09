# Color Hunt frontend API contract

Edit **`src/endpoints.ts`** to change routes, methods, the full API prefix, WebSocket URL, auth URLs, and event names. The default prefix is `/api/v1`. `VITE_API_BASE_URL=https://example.com/prod` maps `/games` to `https://example.com/prod/games`.

This contract is implemented by the bundled **local manual-judging demo**. AWS services are not provisioned by the frontend. The live backend must enforce authorization, deadlines, unique submissions, moderation, score calculation, and token expiry. Client-side controls are only presentation.

The Python Lambda implementation in [`../../backend/`](../../backend/README.md) now implements this contract, the handoff's individual prompt CRUD/read routes, and the ticket/retry extensions. See [AWS.md](AWS.md) for activation settings. It has been tested locally with mocked AWS services; account deployment and live integration verification are still required.

## HTTP routes used by this frontend

| Key in endpoints.ts | Method | Path                                  | Body                                       | Response                     |
| ------------------- | ------ | ------------------------------------- | ------------------------------------------ | ---------------------------- |
| createGame          | POST   | `/games`                              | none                                       | `{session, game}` (201)      |
| joinGame            | POST   | `/games/join`                         | `{gameCode, displayName}`                  | `{session, game}` (201)      |
| gameState           | GET    | `/games/:gameId/state`                | none                                       | `Game`                       |
| savePrompts         | POST   | `/games/:gameId/rounds`               | `{prompts: Prompt[]}`                      | `Game`                       |
| startGame           | POST   | `/games/:gameId/start`                | none                                       | `Game`                       |
| nextRound           | POST   | `/games/:gameId/rounds/next`          | none                                       | `Game`                       |
| finishGame          | POST   | `/games/:gameId/finish`               | none                                       | `Game`                       |
| uploadUrl           | POST   | `/rounds/:roundId/upload-url`         | `{contentType, size, idempotencyKey}`      | `UploadTicket`               |
| submitPhoto         | POST   | `/rounds/:roundId/submissions`        | `{submissionId, imageKey, idempotencyKey}` | `Game` (201; 200 for replay) |
| judgment            | PATCH  | `/submissions/:submissionId/judgment` | `{status, reason, moderationStatus}`       | `Game`                       |
| retryJudgment       | POST   | `/submissions/:submissionId/retry`    | none                                       | `Game`                       |
| socketTicket        | POST   | `/games/:gameId/connection-ticket`    | none                                       | `{ticket}`                   |

`savePrompts` is an **atomic replacement of the ordered prompt list**. Both the bundled demo and the Python backend support it; the Python backend also supports single-prompt POST/PATCH/DELETE. Only drafts/lobbies can be edited. IDs returned by the server are authoritative. `gameState` bundles players, current-round submissions, and ranking so separate results/ranking requests are unnecessary for the existing UI.

The local service does not expose a WebSocket ticket endpoint because no local WebSocket URL is configured. Its retry-judgment route explains that manual judging is required; live AWS should requeue a failed judgment and return the updated state.

All API responses use JSON and `Cache-Control: no-store`. Errors use non-2xx status and `{ "error": "User-facing message" }`. The client recognizes 401/403/404 on state restoration as an invalid session. Other failures trigger retry/offline feedback.

## Authentication and identity

Every protected route receives `Authorization: Bearer <session.token>`. On live game creation, the header initially contains either the host access code (`VITE_ADMIN_AUTH_MODE=token`) or the OIDC access token (`oidc`). The Python backend verifies that credential and returns a new game-scoped session token. Players get their own temporary token when joining. Player IDs are derived from credentials, never from client-provided IDs. The host access code is entered into a password field and stored per tab, not placed in a `VITE_*` environment variable.

```ts
interface Session {
  gameId: string;
  token: string;
  role: "ADMIN" | "PLAYER";
  playerId?: string;
}
```

Only join and local demo game creation are anonymous. Admin tokens authorize configuration/start/next/finish/judgment; player tokens authorize their own uploads and submissions. Never include credentials in game state. The local service deliberately permits creating a new demo admin session without Cognito; do not expose it publicly.

Configure Cognito/OIDC authorize and token endpoints, public client ID, redirect URI, and scopes in `src/endpoints.ts` or `.env.local`. `src/auth.ts` performs authorization code + S256 PKCE and validates state. Access tokens stay in tab session storage until expiry; reauthentication is required when a session expires. There is no refresh-token flow or embedded secret.

## Data shapes

The authoritative TypeScript definitions are in `src/types.ts`. Dates are Unix milliseconds.

```ts
interface Prompt {
  roundId: string;
  promptText: string;
  acceptedLabels: string[];
  minConfidence: number; // 0–100, default 85
}
interface Game {
  gameId: string;
  gameCode: string; // six uppercase alphanumeric characters
  status:
    | "DRAFT"
    | "LOBBY"
    | "COUNTDOWN"
    | "ACTIVE"
    | "JUDGING"
    | "RESULTS"
    | "FINISHED";
  currentRound: number; // 0 before first round; otherwise 1-based
  totalRounds: number;
  serverTime: number;
  revision: number; // monotonically increasing on state changes
  reviewMode: "manual" | "automatic";
  players: Array<{
    playerId: string;
    displayName: string;
    color: number;
    totalScore: number;
    rank: number;
  }>;
  prompts?: Prompt[]; // ADMIN ONLY
  round: null | {
    roundId: string;
    roundNumber: number;
    startAt: number;
    endAt: number;
    promptText?: string; // ABSENT until ACTIVE, including during COUNTDOWN
  };
  submissions: Submission[]; // current round; own only for PLAYER, all for ADMIN
}
interface Submission {
  submissionId: string;
  roundId: string;
  playerId: string;
  submittedAt: number;
  elapsedMs: number;
  status: "PENDING" | "CORRECT" | "INCORRECT" | "ERROR";
  moderationStatus: "PENDING" | "SAFE" | "BLOCKED";
  photoUrl?: string; // short-lived; SAFE wall images, or the owner's own preview
  reviewUrl?: string; // ADMIN ONLY: private pending moderation view
  earnedScore: number | null; // null until all judgments in the round resolve
  rank: number | null;
  detectedLabels: Array<{ name: string; confidence: number }>;
}
```

Use absolute signed HTTPS photo URLs in a cross-origin live backend. Do not send other players' photos to player clients. `reviewUrl` is exclusively for an authorized moderator's private review dialog; it is never rendered in the shared wall. The submission Lambda records the photo as `PENDING`; it does not judge it. The existing judgment route is a separate operation. The notification Lambda only announces data changes.

## Image submission

1. Capture a JPEG in-browser with `getUserMedia`; compress its longest edge to at most 1280px at quality 0.78. Maximum 2MB. No library selection.
2. Request `uploadUrl` using a stable idempotency key for this capture. The server binds the ticket to the player, round, MIME type and image key.
3. `PUT` the Blob to the returned `uploadUrl`, using returned `headers`. **Do not send the API bearer token to S3.**
4. Call `submitPhoto` with the same ticket and idempotency key. Only this confirmation's server receipt time determines order. Validate `0 <= submittedAt - startAt < 15000`.
5. Return a `Game` containing the accepted `PENDING` submission. Later events/state reads provide the judgment. A lost response is recovered by fetching state; retries must not create a second submission.

```ts
interface UploadTicket {
  submissionId: string;
  imageKey: string;
  uploadUrl: string;
  headers?: Record<string, string>;
}
```

Live S3 CORS must allow the frontend origin, `PUT`, and ticket-required headers. API CORS must allow the frontend origin, `Authorization`, `Content-Type`, and all configured methods. Do not make the image bucket public. The local service emulates upload tickets and short-lived signed private images.

## Realtime and clock synchronization

When `VITE_WS_URL` is configured, the client requests a short-lived ticket through the authenticated HTTP API and connects to `<websocketUrl>?ticket=<ticket>`. Validate and consume the ticket at connect. Do not use a long-lived bearer token in the URL.

Send a JSON event with `type` (or `event`) from this list:

`PLAYER_JOINED`, `PLAYER_LEFT`, `ROUND_COUNTDOWN`, `ROUND_STARTED`, `SUBMISSION_RECEIVED`, `SUBMISSION_JUDGED`, `ROUND_CLOSED`, `ROUND_RESULT`, `RANKING_UPDATED`, `GAME_FINISHED`.

The frontend treats events as invalidations and fetches an authorized snapshot. WebSocket reconnection uses exponential backoff up to 30 seconds and always resynchronizes on connect. HTTP polling continues once per second with or without WebSockets. State requests advance the round deadlines using server timestamps, so no background scheduler is required. Focus/online events also refresh state. Messages for other games and already-applied revisions are ignored. Ping/PONG heartbeats detect silent disconnections. Older revisions cannot overwrite newer snapshots. This snapshot approach favors a simple replaceable contract; load-test and consider scoped event payloads before large production events.

Timers use `serverTime` adjusted for half the HTTP round-trip delay. Time expiry disables capture/submission, but only the backend advances the game state and accepts/rejects photos.

## Scoring and transitions

`DRAFT → LOBBY → COUNTDOWN → ACTIVE → JUDGING → RESULTS`, then host-controlled next round or `FINISHED` after the final round.

- Countdown: 3 seconds. Active submission window: 15 seconds.
- Correct submissions rank by server confirmation time; judging completion order is irrelevant.
- Rank points: 100 / 80 / 60 / 40 / 20 (rank 5+).
- Equal timestamps have equal ranks; competition ranks skip places (1, 1, 3).
- `PENDING` and `ERROR` prevent result finalization. System failure is never silently treated as incorrect.
- Judgment changes require a reason, are audited server-side, and recompute round and total scores without additive duplication.
- Final ties share a rank; the podium groups everyone at ranks 1, 2 and 3, and the list shows every player.
