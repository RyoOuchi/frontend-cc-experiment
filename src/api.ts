import { connection, endpoints, integrationEndpoints } from "./endpoints";
import type {
  Game,
  Prompt,
  Session,
  SessionResponse,
  UploadTicket,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
type Endpoint = { method: string; path: string };
export function serviceUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  return `${connection.apiBaseUrl}${path}`;
}
async function request<T>(
  endpoint: Endpoint,
  token?: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    connection.requestTimeoutMs,
  );
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(serviceUrl(endpoint.path), {
      method: endpoint.method,
      signal: controller.signal,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(
        data?.error ||
          data?.message ||
          "通信に失敗しました。もう一度お試しください。",
        response.status,
      );
    if (!data) throw new Error("サーバーの応答を確認できませんでした。");
    return data as T;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError" &&
      !signal?.aborted
    )
      throw new Error("接続がタイムアウトしました。通信状態をご確認ください。");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
export const api = {
  createGame: (adminToken?: string) =>
    request<SessionResponse>(endpoints.createGame(), adminToken),
  joinGame: (gameCode: string, displayName: string) =>
    request<SessionResponse>(endpoints.joinGame(), undefined, {
      gameCode,
      displayName,
    }),
  state: (session: Session, signal?: AbortSignal) =>
    request<Game>(
      endpoints.gameState(session.gameId),
      session.token,
      undefined,
      signal,
    ),
  savePrompts: (session: Session, prompts: Prompt[]) =>
    request<Game>(endpoints.savePrompts(session.gameId), session.token, {
      prompts,
    }),
  start: (session: Session) =>
    request<Game>(endpoints.startGame(session.gameId), session.token),
  next: (session: Session) =>
    request<Game>(endpoints.nextRound(session.gameId), session.token),
  finish: (session: Session) =>
    request<Game>(endpoints.finishGame(session.gameId), session.token),
  judge: (
    session: Session,
    submissionId: string,
    status: "CORRECT" | "INCORRECT",
    reason: string,
    moderationStatus?: "SAFE" | "BLOCKED",
  ) =>
    request<Game>(endpoints.judgment(submissionId), session.token, {
      status,
      reason,
      moderationStatus,
    }),
  retryJudgment: (session: Session, submissionId: string) =>
    request<Game>(
      integrationEndpoints.retryJudgment(submissionId),
      session.token,
    ),
  socketTicket: (session: Session, signal?: AbortSignal) =>
    request<{ ticket: string }>(
      integrationEndpoints.socketTicket(session.gameId),
      session.token,
      undefined,
      signal,
    ),
  uploadTicket: (
    session: Session,
    roundId: string,
    file: Blob,
    idempotencyKey: string,
  ) =>
    request<UploadTicket>(endpoints.uploadUrl(roundId), session.token, {
      contentType: file.type,
      size: file.size,
      idempotencyKey,
    }),
  upload: async (ticket: UploadTicket, file: Blob, signal: AbortSignal) => {
    // Never send the player's bearer token to S3.
    const response = await fetch(ticket.uploadUrl, {
      method: "PUT",
      body: file,
      signal,
      headers: ticket.headers || { "Content-Type": file.type },
    });
    if (!response.ok)
      throw new Error(
        "写真のアップロードに失敗しました。もう一度お試しください。",
      );
  },
  confirmPhoto: (
    session: Session,
    roundId: string,
    ticket: UploadTicket,
    idempotencyKey: string,
  ) =>
    request<Game>(endpoints.submitPhoto(roundId), session.token, {
      submissionId: ticket.submissionId,
      imageKey: ticket.imageKey,
      idempotencyKey,
    }),
};
const sessionKey = (role: Session["role"]) =>
  `color-hunt-${role.toLowerCase()}-v1${connection.mode === "demo" ? "" : `:${connection.apiBaseUrl}`}`;
export function saveSession(session: Session) {
  try {
    sessionStorage.setItem(sessionKey(session.role), JSON.stringify(session));
  } catch {
    /* In-memory play still works. */
  }
}
export function getSession(role: Session["role"]): Session | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(sessionKey(role)) || "null",
    );
    return value?.gameId && value?.token && value.role === role ? value : null;
  } catch {
    return null;
  }
}
export function clearSession(role: Session["role"]) {
  sessionStorage.removeItem(sessionKey(role));
}
