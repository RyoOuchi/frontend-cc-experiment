# AWS connection

The complete Lambda implementation and deployment/upload instructions are in [`../../backend/README.md`](../../backend/README.md). The implementation is locally tested; it has not been deployed to your AWS account.

| Setting       | Value                                                        |
| ------------- | ------------------------------------------------------------ |
| Region        | `us-east-1`                                                  |
| Stage         | `dev`                                                        |
| HTTP API      | `https://q4dvfowmm5.execute-api.us-east-1.amazonaws.com/dev` |
| WebSocket API | `wss://n6x63b8svl.execute-api.us-east-1.amazonaws.com/dev`   |

Upload the backend scripts and connect their routes/triggers using [`../../backend/ROUTES.md`](../../backend/ROUTES.md) before activating these URLs. Then copy `.env.aws.example` to `.env.local` and restart `npm run dev` (or rebuild for deployment).

```dotenv
VITE_API_BASE_URL=https://q4dvfowmm5.execute-api.us-east-1.amazonaws.com/dev
VITE_WS_URL=wss://n6x63b8svl.execute-api.us-east-1.amazonaws.com/dev
VITE_ADMIN_AUTH_MODE=token
```

The frontend uses Vite, not Next.js. Set `VITE_API_BASE_URL`, not `NEXT_PUBLIC_API_URL`. The base value includes `/dev`; endpoint paths are appended without another `/api/v1` prefix.

Host access-code mode does not require Cognito. Generate a code with `backend/tools/create_host_code.py`, set its SHA-256 hash as `HOST_TOKEN_SHA256` on the management Lambda, and enter the actual code at `/admin`. Do not store the actual host code in frontend environment variables. Optional OIDC support remains in the modular source; that mode requires its extra dependencies and the existing `VITE_ADMIN_*` settings.

All frontend methods/paths remain centralized in `src/endpoints.ts`. The Lambda router implements the 16 supplied HTTP routes plus `/submissions/{submissionId}/retry` and `/games/{gameId}/connection-ticket`. The prompt POST route accepts both the current editor's `{prompts: [...]}` bulk replacement and one-prompt additions. State and mutation responses match `src/types.ts`; no speculative JSON adapter is required.

WebSockets use one-use 30-second tickets issued by the authenticated HTTP API. The `$connect` handler consumes the ticket and associates the connection with its game. The notification handler pushes only `{type, gameId, revision}` to that game's connections, and the frontend refreshes its authorized snapshot. The four-function realtime setup is documented in [`../../backend/REALTIME.md`](../../backend/REALTIME.md). Leave `VITE_WS_URL` blank only when testing HTTP on its own. Polling advances deadlines and refreshes the UI once per second. To enable WebSockets, configure the two realtime functions and the DynamoDB stream, then set `VITE_WS_URL=wss://n6x63b8svl.execute-api.us-east-1.amazonaws.com/dev`. No queue is used.

Game sessions and host credentials are scoped to the configured API URL in browser storage, so switching between the demo and AWS does not reuse local game credentials. Create a new AWS game; local demo room B08002 is not migrated. The player screen still omits the overall ranking list.

Before deployment, the last live check on 2026-11-09 found a placeholder response from POST `/games` and 404s from join/preflight requests. Those observations describe the old deployed functions, not the new implementation in this repository. After uploading, verify CORS, permissions, real photo uploads, submission recording and WebSocket event delivery in your account.
