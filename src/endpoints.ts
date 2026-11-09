/**
 * The single place to change EVERY frontend service URL and HTTP method.
 * VITE_API_BASE_URL is the full API prefix, e.g. https://example.com/prod.
 * Paths here are relative to that prefix. S3 upload URLs come from the API.
 */
export const connection = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(
    /\/$/,
    "",
  ),
  websocketUrl: import.meta.env.VITE_WS_URL || "",
  mode: import.meta.env.VITE_API_BASE_URL ? "live" : "demo",
  requestTimeoutMs: 12_000,
  pollIntervalMs: 1_000,
  auth: {
    mode: import.meta.env.VITE_ADMIN_AUTH_MODE === "token" ? "token" : "oidc",
    authorizeUrl: import.meta.env.VITE_ADMIN_AUTHORIZE_URL || "",
    tokenUrl: import.meta.env.VITE_ADMIN_TOKEN_URL || "",
    clientId: import.meta.env.VITE_ADMIN_CLIENT_ID || "",
    redirectUri:
      import.meta.env.VITE_ADMIN_REDIRECT_URI || `${location.origin}/admin`,
    scope: import.meta.env.VITE_ADMIN_SCOPE || "openid email profile",
  },
} as const;
const id = encodeURIComponent;
const route = (
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
) => ({ method, path });
/** HTTP routes implemented in backend/src/color_hunt/http.py.
 * Both single-prompt CRUD and the frontend's atomic bulk save are supported.
 */
export const endpoints = {
  // Administrator routes (10).
  createGame: () => route("POST", "/games"),
  gameInfo: (gameId: string) => route("GET", `/games/${id(gameId)}`),
  addPrompt: (gameId: string) => route("POST", `/games/${id(gameId)}/rounds`),
  savePrompts: (gameId: string) => route("POST", `/games/${id(gameId)}/rounds`),
  updatePrompt: (gameId: string, roundId: string) =>
    route("PATCH", `/games/${id(gameId)}/rounds/${id(roundId)}`),
  deletePrompt: (gameId: string, roundId: string) =>
    route("DELETE", `/games/${id(gameId)}/rounds/${id(roundId)}`),
  startGame: (gameId: string) => route("POST", `/games/${id(gameId)}/start`),
  nextRound: (gameId: string) =>
    route("POST", `/games/${id(gameId)}/rounds/next`),
  submissions: (gameId: string) =>
    route("GET", `/games/${id(gameId)}/submissions`),
  judgment: (submissionId: string) =>
    route("PATCH", `/submissions/${id(submissionId)}/judgment`),
  finishGame: (gameId: string) => route("POST", `/games/${id(gameId)}/finish`),

  // Player routes (6).
  joinGame: () => route("POST", "/games/join"),
  gameState: (gameId: string) => route("GET", `/games/${id(gameId)}/state`),
  uploadUrl: (roundId: string) =>
    route("POST", `/rounds/${id(roundId)}/upload-url`),
  submitPhoto: (roundId: string) =>
    route("POST", `/rounds/${id(roundId)}/submissions`),
  roundResults: (roundId: string) =>
    route("GET", `/rounds/${id(roundId)}/results`),
  ranking: (gameId: string) => route("GET", `/games/${id(gameId)}/ranking`),
};

/** Optional routes: WebSocket tickets and retry compatibility (409 in manual mode). */
export const integrationEndpoints = {
  retryJudgment: (submissionId: string) =>
    route("POST", `/submissions/${id(submissionId)}/retry`),
  socketTicket: (gameId: string) =>
    route("POST", `/games/${id(gameId)}/connection-ticket`),
};
export const realtime = {
  heartbeatIntervalMs: 30_000,
  heartbeatTimeoutMs: 10_000,
  reconnectMaxMs: 30_000,
  ticketParameter: "ticket",
  events: [
    "PLAYER_JOINED",
    "PLAYER_LEFT",
    "ROUND_COUNTDOWN",
    "ROUND_STARTED",
    "SUBMISSION_RECEIVED",
    "SUBMISSION_JUDGED",
    "ROUND_CLOSED",
    "ROUND_RESULT",
    "RANKING_UPDATED",
    "GAME_FINISHED",
  ],
};
