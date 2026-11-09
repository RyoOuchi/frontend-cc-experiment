import { connection } from "./endpoints";
const namespace = `${connection.apiBaseUrl}:${connection.auth.mode}:${connection.auth.clientId}`;
const key = `color-hunt-auth-pkce:${namespace}`;
const authKey = `color-hunt-admin-auth:${namespace}`;
export function storeHostAccessCode(code: string) {
  const token = code.trim();
  if (token.length < 32 || token.length > 512)
    throw new Error("発行されたホストアクセスコードを入力してください。");
  sessionStorage.setItem(
    authKey,
    JSON.stringify({ token, expiresAt: Date.now() + 12 * 60 * 60 * 1000 }),
  );
}
export function clearAdminToken() {
  sessionStorage.removeItem(authKey);
}
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export function adminToken() {
  try {
    const data = JSON.parse(sessionStorage.getItem(authKey) || "null");
    return data?.expiresAt > Date.now() ? (data.token as string) : undefined;
  } catch {
    return undefined;
  }
}
export async function signIn() {
  const config = connection.auth;
  if (!config.authorizeUrl || !config.tokenUrl || !config.clientId)
    throw new Error(
      "管理者ログインが未設定です。管理者認証の接続設定を確認してください。",
    );
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(24)));
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  sessionStorage.setItem(key, JSON.stringify({ verifier, state }));
  const url = new URL(config.authorizeUrl);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  location.assign(url);
}
export async function completeSignIn(): Promise<boolean> {
  if (connection.auth.mode === "token") return false;
  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("error")) return false;
  const saved = JSON.parse(sessionStorage.getItem(key) || "null");
  history.replaceState(null, "", location.pathname);
  sessionStorage.removeItem(key);
  if (params.has("error"))
    throw new Error("ログインがキャンセルされたか、認証に失敗しました。");
  if (!saved || params.get("state") !== saved.state)
    throw new Error("認証の確認に失敗しました。もう一度ログインしてください。");
  const response = await fetch(connection.auth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: connection.auth.clientId,
      code: params.get("code")!,
      redirect_uri: connection.auth.redirectUri,
      code_verifier: saved.verifier,
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token)
    throw new Error(
      "認証を完了できませんでした。もう一度ログインしてください。",
    );
  sessionStorage.setItem(
    authKey,
    JSON.stringify({
      token: result.access_token,
      expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000,
    }),
  );
  return true;
}
